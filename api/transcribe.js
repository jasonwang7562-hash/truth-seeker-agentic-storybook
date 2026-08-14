const { handleTranscribeRequest, readBinaryBody } = require("../lib/transcribe-runtime");

async function transcribeHandler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : await readBinaryBody(req);
    const result = await handleTranscribeRequest({ headers: req.headers, buffer });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: "bad_audio",
        message: "我没有听清楚。可以再说一次，或者打字。",
      })
    );
  }
}

module.exports = transcribeHandler;
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
