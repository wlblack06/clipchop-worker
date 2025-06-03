const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const rateLimit = require("express-rate-limit");
const OpenAI = require("openai");
const multer = require("multer");

const app = express();
const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.set("trust proxy", 1); // Fix for rate limiting behind proxy (Render)

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: "Too many requests, try again later." }
});
app.use("/process", limiter);
app.use("/analyze", limiter);

// Util to cleanup files
const cleanupFiles = (files) => {
  files.forEach((f) => {
    fs.unlink(f, (err) => {
      if (err) console.error(`Failed to delete ${f}:`, err.message);
    });
  });
};

// Download video using yt-dlp
const downloadVideo = (videoUrl, outputPath) => {
  return new Promise((resolve, reject) => {
    exec(`yt-dlp -o ${outputPath} "${videoUrl}"`, (error, stdout, stderr) => {
      if (error) {
        console.error("yt-dlp error:", stderr);
        reject(error);
      } else {
        resolve();
      }
    });
  });
};

// Transcribe using Whisper
const transcribeVideo = async (filepath) => {
  return await openai.audio.transcriptions.create({
    file: fs.createReadStream(filepath),
    model: "whisper-1"
  });
};

// Clip using ffmpeg
const clipVideo = (input, output, start, end) => {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i ${input} -ss ${start} -to ${end} -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ${output}`;
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
};

// /process endpoint
app.post("/process", async (req, res) => {
  const { videoUrl, clips } = req.body;
  if (!videoUrl || !clips || !Array.isArray(clips)) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const timestamp = Date.now();
  const videoPath = `video_${timestamp}.mp4`;

  try {
    await downloadVideo(videoUrl, videoPath);
    const transcript = await transcribeVideo(videoPath);
    const clipFilenames = [];

    for (let i = 0; i < clips.length; i++) {
      const { start, end } = clips[i];
      const outName = `clip_${i}_${timestamp}.mp4`;
      await clipVideo(videoPath, outName, start, end);
      clipFilenames.push(outName);
    }

    res.json({
      transcript: transcript.text,
      clips: clipFilenames
    });

    setTimeout(() => cleanupFiles([videoPath, ...clipFilenames]), 60_000);
  } catch (err) {
    console.error("🔥 Processing error:", err);
    cleanupFiles([videoPath]);
    res.status(500).json({ error: "Processing failed" });
  }
});

// /analyze endpoint
app.post("/analyze", async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: "Missing videoUrl" });

  const videoPath = `video_${Date.now()}.mp4`;
  try {
    await downloadVideo(videoUrl, videoPath);
    const transcript = await transcribeVideo(videoPath);

    const highlightResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You are an AI that analyzes video transcripts to find viral TikTok moments. Return ONLY a valid JSON array with structure:
[
  {
    "title": "Brief catchy title",
    "summary": "Why this moment could go viral",
    "start_time": 15,
    "end_time": 45,
    "viral_score": 8.5
  }
]
Rules:
- 3 to 6 highlights, 15–60 seconds each.
- viral_score: 1–10
- Focus on humor, insight, surprise, emotion.`
        },
        {
          role: "user",
          content: `Analyze this transcript:\n\n${transcript.text}`
        }
      ]
    });

    let highlights;
    try {
      highlights = JSON.parse(highlightResponse.choices[0].message.content);
    } catch {
      highlights = [
        {
          title: "Highlight",
          summary: "Fallback moment",
          start_time: 30,
          end_time: 60,
          viral_score: 7
        }
      ];
    }

    res.json({ transcript: transcript.text, highlights });
    setTimeout(() => cleanupFiles([videoPath]), 60_000);
  } catch (err) {
    console.error("🔥 Analysis error:", err);
    cleanupFiles([videoPath]);
    res.status(500).json({ error: "Analyze failed" });
  }
});

// /download/:filename endpoint
app.get("/download/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, filename);

  if (!fs.existsSync(filePath) || !filename.includes("clip_")) {
    return res.status(404).json({ error: "File not found" });
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

// /health endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
