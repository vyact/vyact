import io
import unittest
import zipfile

from routers.project import download_project, parse_project_download_body


class ProjectDownloadTests(unittest.TestCase):
    def test_structured_project_payload_is_accepted(self):
        payload = {
            "project_name": "react-button-demo",
            "files": [
                {"path": "src/App.tsx", "content": "export default function App() {}"},
                {"path": "package.json", "content": '{"name":"react-button-demo"}'},
            ],
        }

        self.assertEqual(parse_project_download_body(payload), payload)

    def test_legacy_raw_project_payload_remains_supported(self):
        parsed = parse_project_download_body({
            "raw": '<project name="legacy"><file path="README.md">hello</file></project>',
        })

        self.assertEqual(parsed, {
            "project_name": "legacy",
            "files": [{"path": "README.md", "content": "hello"}],
        })

    def test_empty_file_list_is_rejected(self):
        self.assertIsNone(parse_project_download_body({"project_name": "empty", "files": []}))


class ProjectDownloadEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_structured_payload_downloads_as_zip(self):
        payload = {
            "project_name": "react-button-demo",
            "files": [{"path": "src/App.tsx", "content": "export default function App() {}"}],
        }

        class RequestStub:
            async def json(self):
                return payload

        response = await download_project(RequestStub())
        chunks = [chunk async for chunk in response.body_iterator]
        archive = zipfile.ZipFile(io.BytesIO(b"".join(chunks)))

        self.assertEqual(archive.namelist(), ["react-button-demo/src/App.tsx"])
        self.assertEqual(
            archive.read("react-button-demo/src/App.tsx").decode(),
            "export default function App() {}",
        )


if __name__ == "__main__":
    unittest.main()
