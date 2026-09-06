const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPrompts,
  buildTranscriptPolishingPrompt,
} = require("../src/helpers/aiPrompts");
const AITextProcessor = require("../src/helpers/aiTextProcessor");

const logger = { info() {}, warn() {}, error() {} };

test("所有 transcript 長度共用同一套臺灣繁體中文受限完整潤稿 prompt", () => {
  const transcript = "請幫我回答這個問題，and keep this English phrase。";
  const prompts = buildPrompts(transcript);

  assert.equal(prompts.optimize, prompts.optimize_long);
  assert.match(prompts.optimize, /標點/);
  assert.match(prompts.optimize, /斷句/);
  assert.match(prompts.optimize, /贅詞/);
  assert.match(prompts.optimize, /重複/);
  assert.match(prompts.optimize, /文法/);
  assert.match(prompts.optimize, /語序/);
  assert.match(prompts.optimize, /中英文混用/);
  assert.match(prompts.optimize, /不得翻譯/);
  assert.match(prompts.optimize, /待編輯的資料/);
  assert.match(prompts.optimize, /不得回答/);
  assert.match(prompts.optimize, /不得執行/);
  assert.match(prompts.optimize, new RegExp(transcript.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("自訂潤稿提示詞會原樣使用，逐字稿由主程序固定附加", () => {
  const prompt = buildTranscriptPolishingPrompt(
    "保留這段原始逐字稿。",
    "  只修正標點，不調整用詞。  ",
  );

  assert.equal(prompt, `只修正標點，不調整用詞。\n\n<transcript>\n保留這段原始逐字稿。\n</transcript>`);
  assert.doesNotMatch(prompt, /改善標點、斷句與段落/);
});

test("主程序提供預設提示詞，並拒絕以空白覆寫已保存內容", async () => {
  let savedPrompt;
  const database = {
    getSetting(key, defaultValue) {
      if (key === "transcript_polishing_prompt") return savedPrompt ?? defaultValue;
      return undefined;
    },
    setSetting(key, value) {
      assert.equal(key, "transcript_polishing_prompt");
      savedPrompt = value;
      return { changes: 1 };
    },
  };
  const processor = new AITextProcessor(database, logger);

  const initial = await processor.getTranscriptPolishingPrompt();
  assert.match(initial, /臺灣繁體中文/);

  await processor.setTranscriptPolishingPrompt("  只修正標點。  ");
  assert.equal(savedPrompt, "只修正標點。");
  await assert.rejects(
    processor.setTranscriptPolishingPrompt("   "),
    { code: "polishing_prompt_invalid" },
  );
  assert.equal(savedPrompt, "只修正標點。");
});

test("每次潤稿都讀取目前已保存提示詞，不綁定 provider 或呼叫來源", async () => {
  const captured = [];
  let savedPrompt = "第一版指令";
  const adapter = {
    async process(request) {
      captured.push(request.messages[1].content);
      return { success: true, text: "最終結果" };
    },
  };
  const database = {
    getSetting(key) {
      return ({
        ai_provider: "ollama",
        ai_model: "qwen3:1.7b",
        transcript_polishing_prompt: savedPrompt,
      })[key];
    },
  };
  const processor = new AITextProcessor(database, logger, { ollama: adapter });

  await processor.processTextWithAI("錄音流程原文", "optimize");
  savedPrompt = "第二版指令";
  await processor.processTextWithAI("歷史流程原文", "optimize");

  assert.equal(captured[0], "第一版指令\n\n<transcript>\n錄音流程原文\n</transcript>");
  assert.equal(captured[1], "第二版指令\n\n<transcript>\n歷史流程原文\n</transcript>");
});

test("self-correction 原文不經確定性改寫，直接交給 provider", async () => {
  const captured = [];
  const adapter = {
    async process(request) {
      captured.push(request);
      return { success: true, text: "最終結果" };
    },
  };
  const database = {
    getSetting(key) {
      return ({
        ai_provider: "ollama",
        ai_model: "qwen3:1.7b",
      })[key];
    },
  };
  const processor = new AITextProcessor(database, logger, { ollama: adapter });
  const transcript = "會議在週三，不對，改成週四，我是說下午。";

  const result = await processor.processTextWithAI(transcript, "optimize");

  assert.equal(result.success, true);
  assert.match(captured[0].messages[1].content, new RegExp(transcript));
});

test("超過固定 context 安全上限時直接失敗，不截斷、不分段、不呼叫 provider", async () => {
  let calls = 0;
  const adapter = { async process() { calls += 1; return { success: true, text: "不應發生" }; } };
  const database = {
    getSetting(key) {
      return ({
        ai_provider: "ollama",
        ai_model: "qwen3:1.7b",
      })[key];
    },
  };
  const processor = new AITextProcessor(database, logger, { ollama: adapter });
  const result = await processor.processTextWithAI("字".repeat(501), "optimize");

  assert.equal(result.success, false);
  assert.equal(result.code, "input_over_limit");
  assert.equal(calls, 0);
});
