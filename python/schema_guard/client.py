import json
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, Optional

class SchemaGuardClient:
    """Use the local canonical engine or a compatible HTTP endpoint."""
    def __init__(self, base_url: Optional[str] = None, repository: Optional[Path] = None):
        self.base_url = base_url.rstrip("/") if base_url else None
        self.repository = repository or Path(__file__).resolve().parents[2]

    def validate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        if self.base_url:
            body = json.dumps(request).encode("utf-8")
            http_request = urllib.request.Request(self.base_url + "/v1/validate", data=body, headers={"content-type": "application/json"}, method="POST")
            try:
                with urllib.request.urlopen(http_request) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                return json.load(error)
        script = "import {validateToolCall} from './packages/core/dist/index.js'; const chunks=[]; for await (const c of process.stdin) chunks.push(c); console.log(JSON.stringify(validateToolCall(JSON.parse(Buffer.concat(chunks)))));"
        completed = subprocess.run(["node", "--input-type=module", "--eval", script], input=json.dumps(request), text=True, cwd=self.repository, check=True, capture_output=True)
        return json.loads(completed.stdout)
