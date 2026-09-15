// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title CarePassRegistry
/// @notice 가족 금융 대리권의 위임·결제·승인 이벤트를 해시로만 기록하는 감사 원장.
///         위임 내용(VC)은 오프체인에 두고, 온체인에는 SHA-256 해시만 남긴다.
contract CarePassRegistry {
    struct Record {
        bytes32 dataHash; // 오프체인 이벤트 원문(JSON)의 SHA-256
        uint256 ts;       // 기록된 블록 시각
        string fn;        // 이벤트 종류 (delegationConfigured, paymentApproved …)
    }

    /// @notice 기록 권한을 가진 계정 (실서비스: 은행 기록 서버 키)
    address public immutable recorder;

    mapping(bytes32 => Record[]) private _history;

    event DelegationLogged(bytes32 indexed id, bytes32 indexed dataHash, string fn, uint256 index);

    error NotRecorder();
    error EmptyHash();

    constructor() {
        recorder = msg.sender;
    }

    /// @notice 위임/결제 이벤트 해시를 체인에 기록 (기록 계정만 가능 — 제3자가 가짜 이력을 끼워 넣지 못함)
    /// @param id 위임 ID 문자열의 SHA-256
    function registerDelegation(bytes32 id, bytes32 dataHash, string calldata fn) external {
        if (msg.sender != recorder) revert NotRecorder();
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
}
