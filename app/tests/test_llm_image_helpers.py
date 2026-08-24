import tempfile
import unittest
from pathlib import Path

from services.llm.helpers import load_image_data_urls


class LlmImageHelperTests(unittest.TestCase):
    def test_image_data_url_keeps_original_mime_type(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            image_path = Path(temp_dir) / "sample.png"
            image_path.write_bytes(b"png-bytes")

            urls = load_image_data_urls([{
                "type": "image",
                "filename": "sample.png",
                "path": str(image_path),
            }])

        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith("data:image/png;base64,"))
