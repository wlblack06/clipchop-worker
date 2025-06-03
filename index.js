const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
const app = express();
app.use(cors());
app.use(express.json());
app.set('trust proxy', true);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/analyze', limiter);
app.use('/process', limiter);

const cleanupFiles = (paths) => {
  paths.forEach((file) => {
    fs.unlink(file, (err) => {
      if (err) console.error(`Failed to delete ${file}:`, err.message);
    });
  });
};

app.post('/analyze', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'Missing videoUrl' });

  const timestamp = Date.now();
  const videoPath = `video_${timestamp}.mp4`;

  try {
    // Download video using yt-dlp
    await new Promise((resolve, reject) => {
      exec(`yt-dlp "${videoUrl}" --output ${videoPath}`, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: 'whisper-1',
    });

    const highlightsResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI that analyzes video transcripts to find viral TikTok moments. Return ONLY a valid JSON array of highlights with this exact structure:
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
- Find 3-6 potential viral moments
- Each clip should be 15-60 seconds long
- viral_score should be 1-10 (higher = more viral potential)
- Focus on: funny moments, key insights, surprising facts, emotional peaks
- Return ONLY the JSON array, no other text`
        },
        {
          role: 'user',
          content: `Analyze this transcript and find viral TikTok moments:\n\n${transcript.text}`
        }
      ],
      temperature: 0.7,
    });

    let highlights;
    try {
      highlights = JSON.parse(highlightsResponse.choices[0].message.content);
    } catch (err) {
      highlights = [
        {
          title: "Key Moment",
          summary: "Fallback summary",
          start_time: 30,
          end_time: 60,
          viral_score: 7.5
        }
      ];
    }

    res.json({ transcript: transcript.text, highlights });
    setTimeout(() => cleanupFiles([videoPath]), 60000);
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze video.' });
    cleanupFiles([videoPath]);
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, req.params.filename);
  if (!fs.existsSync(filePath) || !req.params.filename.includes('clip_')) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
