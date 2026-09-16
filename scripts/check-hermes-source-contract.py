from __future__ import annotations

import json
import os
import sys

source_root = os.environ.get("HERMES_SOURCE_ROOT")
if not source_root:
    raise SystemExit("HERMES_SOURCE_ROOT is required")
sys.path.insert(0, source_root)

from tools import approval
from tools.approval_gateway_wait import _ApprovalEntry
from tui_gateway import event_replay

session_id = "ambient-contract-probe"
request_id = "ambient-contract-approval"

try:
    event_replay.reset_replay_state()
    for _ in range(522):
        event_replay._stamp_event({
            "method": "event",
            "params": {"type": "message.delta", "session_id": session_id, "payload": {"text": "probe"}},
        })
    replayed = event_replay.events_since(session_id, 0)
    approval_entry = _ApprovalEntry({
        "request_id": request_id,
        "command": "probe command",
        "description": "probe description",
        "choices": ["once", "deny"],
    })
    with approval._lock:
        approval._gateway_queues[session_id] = [approval_entry]
    pending = approval.list_gateway_approvals(session_id)
    resolved = approval.resolve_gateway_approval(session_id, "once", request_id=request_id)
    print(json.dumps({
        "replay": {
            "bufferMax": 512,
            "firstRetainedSeq": replayed[0]["seq"],
            "latestSeq": event_replay.latest_seq(session_id),
            "retained": len(replayed),
            "truncatedFromZero": event_replay.is_truncated(session_id, 0),
            "eventKeys": sorted(replayed[0].keys()),
        },
        "approval": {
            "pendingKeys": sorted(pending[0].keys()),
            "requestIdPresent": pending[0].get("request_id") == request_id,
            "resolvedByRequestId": resolved,
        },
    }, sort_keys=True))
finally:
    event_replay.reset_replay_state()
    with approval._lock:
        approval._gateway_queues.pop(session_id, None)
