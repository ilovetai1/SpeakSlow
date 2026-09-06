import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock

from download_all_models import MODELS
from sherpa_server import SherpaServer


class _FakeOfflineRecognizer:
    @staticmethod
    def from_paraformer(**_kwargs):
        return object()


class SherpaMemoryTests(unittest.TestCase):
    def test_download_and_packaging_both_use_int8_punctuation(self):
        punctuation = next(model for model in MODELS if model[0].startswith("標點"))
        _name, url, folder, key_file = punctuation
        self.assertTrue(url.endswith("-int8.tar.bz2"))
        self.assertTrue(folder.endswith("-int8"))
        self.assertEqual(key_file, "model.int8.onnx")

        package = json.loads(
            (Path(__file__).parents[1] / "package.json").read_text(encoding="utf-8")
        )
        packaged_paths = [item["from"] for item in package["build"]["extraResources"]]
        punct_paths = [path for path in packaged_paths if "punct-ct-transformer" in path]
        self.assertEqual(len(punct_paths), 1)
        self.assertTrue(punct_paths[0].endswith("-int8"))

    def test_asr_initialization_does_not_eager_load_punctuation(self):
        with tempfile.TemporaryDirectory() as model_dir:
            for filename in ("model.int8.onnx", "tokens.txt"):
                open(os.path.join(model_dir, filename), "wb").close()

            fake_sherpa = types.SimpleNamespace(
                OfflineRecognizer=_FakeOfflineRecognizer,
                __version__="test",
            )
            with mock.patch.dict(sys.modules, {"sherpa_onnx": fake_sherpa}):
                server = SherpaServer(model_dir=model_dir)
                server._init_vad = mock.Mock()
                server._init_punctuation_model = mock.Mock()

                result = server.initialize()

            self.assertTrue(result["success"])
            server._init_punctuation_model.assert_not_called()
            self.assertIsNone(server.punc_model)
            self.assertFalse(server._punc_model_load_attempted)

    def test_punctuation_loader_uses_int8_model(self):
        with tempfile.TemporaryDirectory() as punct_model_dir:
            int8_path = os.path.join(punct_model_dir, "model.int8.onnx")
            open(int8_path, "wb").close()
            captured = {}

            class FakeModelConfig:
                def __init__(self, **kwargs):
                    captured.update(kwargs)

            class FakeConfig:
                def __init__(self, model):
                    self.model = model

            fake_punctuation = object()
            fake_sherpa = types.SimpleNamespace(
                OfflinePunctuationModelConfig=FakeModelConfig,
                OfflinePunctuationConfig=FakeConfig,
                OfflinePunctuation=lambda _config: fake_punctuation,
            )
            server = SherpaServer.__new__(SherpaServer)
            server.punct_model_dir = punct_model_dir
            server.punc_model = None

            with mock.patch.dict(sys.modules, {"sherpa_onnx": fake_sherpa}):
                result = server._load_punctuation_model()

            self.assertIs(result, fake_punctuation)
            self.assertEqual(captured["ct_transformer"], int8_path)
            self.assertEqual(captured["num_threads"], 1)

    def test_first_punctuation_request_loads_model_once(self):
        server = SherpaServer.__new__(SherpaServer)
        server.punc_model = None
        server._punc_model_load_attempted = False
        server._punc_model_lock = threading.Lock()
        fake_punctuation = mock.Mock()
        fake_punctuation.add_punctuation.return_value = "你好。"

        def load_model():
            server.punc_model = fake_punctuation
            return fake_punctuation

        server._load_punctuation_model = mock.Mock(side_effect=load_model)

        self.assertEqual(server._add_punctuation("你好"), "你好。")
        self.assertEqual(server._add_punctuation("你好"), "你好。")
        server._load_punctuation_model.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
