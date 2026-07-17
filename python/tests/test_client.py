import unittest

from schema_guard import SchemaGuardClient


class SchemaGuardClientTest(unittest.TestCase):
    def test_local_engine_conformance(self):
        decision = SchemaGuardClient().validate(
            {
                "tool_name": "counter",
                "tool_schema": {
                    "type": "object",
                    "required": ["count"],
                    "properties": {"count": {"type": "integer"}},
                },
                "raw_arguments": {"count": "3"},
            }
        )
        self.assertEqual(decision["decision"], "valid_with_repair")
        self.assertEqual(decision["valid_arguments"]["count"], 3)


if __name__ == "__main__":
    unittest.main()
