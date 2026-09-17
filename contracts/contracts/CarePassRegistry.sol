// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CarePassRegistry
/// @notice 두 가지를 담는 공개 장부.
///         ① 가족 금융 대리권의 위임·결제·승인 이벤트를 해시로만 남기는 감사 원장.
///         ② 의료기관 인증(발급·취소) 목록 — 여러 은행·결제대행사·지자체가 함께 조회하는 공용 명부.
///         위임 내용(VC)·청구서 원문은 오프체인에 두고, 온체인에는 해시와 공개키만 둔다.
contract CarePassRegistry {
    struct Record {
        bytes32 dataHash; // 오프체인 이벤트 원문(JSON)의 SHA-256
        uint256 ts;       // 기록된 블록 시각
        string fn;        // 이벤트 종류 (delegationConfigured, paymentApproved …)
    }

    /// @notice 인증된 의료기관 — 청구서 전자서명을 검증할 공개키를 여기서 읽는다.
    struct Institution {
        bytes32 keyX;      // 기관 서명키(ECDSA P-256) 공개키 X 좌표
        bytes32 keyY;      // 같은 공개키 Y 좌표
        bytes32 proofHash; // 인증 근거(건강보험심사평가원 요양기관 목록 해당 행) 원문의 SHA-256
        uint64 issuedAt;   // 인증 발급 시각 (0 = 발급된 적 없음)
        uint64 revokedAt;  // 인증 취소 시각 (0 = 유효)
        string name;       // 기관명 (공개 정보)
    }

    /// @notice 기록·인증 권한을 가진 계정 (실서비스: 은행 기록 서버 키)
    address public immutable recorder;

    mapping(bytes32 => Record[]) private _history;
    mapping(bytes32 => Institution) private _institutions;
    bytes32[] private _institutionIds;

    event DelegationLogged(bytes32 indexed id, bytes32 indexed dataHash, string fn, uint256 index);
    event InstitutionCertified(bytes32 indexed instId, bytes32 keyX, bytes32 keyY, bytes32 proofHash, string name);
    event InstitutionRevoked(bytes32 indexed instId, string reason);

    error NotRecorder();
    error EmptyHash();
    error EmptyKey();
    error AlreadyCertified();
    error NotCertified();

    constructor() {
        recorder = msg.sender;
    }

    modifier onlyRecorder() {
        if (msg.sender != recorder) revert NotRecorder();
        _;
    }

    /* ───────────────────────── ① 위임·결제 이력 ───────────────────────── */

    /// @notice 위임/결제 이벤트 해시를 체인에 기록 (기록 계정만 가능 — 제3자가 가짜 이력을 끼워 넣지 못함)
    /// @param id 위임 ID 문자열의 SHA-256
    function registerDelegation(bytes32 id, bytes32 dataHash, string calldata fn) external onlyRecorder {
        if (dataHash == bytes32(0)) revert EmptyHash();
        _history[id].push(Record(dataHash, block.timestamp, fn));
        emit DelegationLogged(id, dataHash, fn, _history[id].length - 1);
    }

    /// @notice 위임 ID의 전체 이력 조회 → 타임라인 화면 (누구나 조회·검증 가능)
    function getHistory(bytes32 id) external view returns (Record[] memory) {
        return _history[id];
    }

    function historyCount(bytes32 id) external view returns (uint256) {
        return _history[id].length;
    }

    /* ───────────────────────── ② 의료기관 인증 ───────────────────────── */

    /// @notice 요양기관 목록으로 실재가 확인된 기관에 인증을 발급하고 서명 공개키를 공개한다.
    ///         취소된 기관은 다시 발급할 수 있다(서명키 교체·자격 회복).
    /// @param instId 기관 식별자 — SHA-256("기관명|종별|구군")
    function certifyInstitution(
        bytes32 instId,
        bytes32 keyX,
        bytes32 keyY,
        bytes32 proofHash,
        string calldata name
    ) external onlyRecorder {
        if (keyX == bytes32(0) || keyY == bytes32(0)) revert EmptyKey();
        if (proofHash == bytes32(0)) revert EmptyHash();
        Institution storage inst = _institutions[instId];
        if (inst.issuedAt != 0 && inst.revokedAt == 0) revert AlreadyCertified();
        if (inst.issuedAt == 0) _institutionIds.push(instId);
        inst.keyX = keyX;
        inst.keyY = keyY;
        inst.proofHash = proofHash;
        inst.issuedAt = uint64(block.timestamp);
        inst.revokedAt = 0;
        inst.name = name;
        emit InstitutionCertified(instId, keyX, keyY, proofHash, name);
    }

    /// @notice 인증 취소 — 폐업·자격정지·서명키 유출 시. 취소 이력도 체인에 남는다.
    function revokeInstitution(bytes32 instId, string calldata reason) external onlyRecorder {
        Institution storage inst = _institutions[instId];
        if (inst.issuedAt == 0 || inst.revokedAt != 0) revert NotCertified();
        inst.revokedAt = uint64(block.timestamp);
        emit InstitutionRevoked(instId, reason);
    }

    /// @notice 청구서 검증용 — 공개키와 발급·취소 시각만 고정 길이로 반환 (앱이 가볍게 조회)
    function institutionKey(bytes32 instId)
        external
        view
        returns (bytes32 keyX, bytes32 keyY, uint64 issuedAt, uint64 revokedAt)
    {
        Institution storage inst = _institutions[instId];
        return (inst.keyX, inst.keyY, inst.issuedAt, inst.revokedAt);
    }

    /// @notice 기관 인증 전체 내용 조회 (인증 근거 해시·기관명 포함)
    function getInstitution(bytes32 instId) external view returns (Institution memory) {
        return _institutions[instId];
    }

    /// @notice 발급된 적 있고 취소되지 않은 기관인지
    function isCertified(bytes32 instId) external view returns (bool) {
        Institution storage inst = _institutions[instId];
        return inst.issuedAt != 0 && inst.revokedAt == 0;
    }

    function institutionCount() external view returns (uint256) {
        return _institutionIds.length;
    }

    function institutionIdAt(uint256 index) external view returns (bytes32) {
        return _institutionIds[index];
    }
}
