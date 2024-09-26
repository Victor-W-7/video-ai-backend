import express from 'express';
import uniqid from 'uniqid';
import fs from 'fs';
import cors from 'cors';
import { GPTScript, RunEventType } from '@gptscript-ai/gptscript';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.static('stories'));

ffmpeg.setFfmpegPath(ffmpegPath);
const g = new GPTScript();

app.get('/test', (req, res) => {
  return res.json('test ok');
});

app.get('/create-story', async (req, res) => {
  const url = decodeURIComponent(req.query.url);
  const dir = uniqid();
  const storyPath = './stories/' + dir;
  fs.mkdirSync(storyPath, { recursive: true });

  console.log({
    url,
  });

  const opts = {
    input: `--url ${url} --dir ${storyPath}`,
    disableCache: true,
    timeout: 120000,
  };

  try {
    const run = await g.run('./story.gpt', opts);

    run.on(RunEventType.Event, (ev) => {
      if (ev.type === RunEventType.CallFinish && ev.output) {
        console.log(ev.output);
      }
    });

    const result = await run.text();
    return res.json(dir);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Failed to create the story', error: e.message });
  }
});

app.get('/build-video', async (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ message: 'error. missing id' });
  }

  const dir = './stories/' + id;
  const bRollFiles = ['b-roll-1.png', 'b-roll-2.png', 'b-roll-3.png'];
  const voiceoverFiles = ['voiceover-1.mp3', 'voiceover-2.mp3', 'voiceover-3.mp3'];
  const transcriptionFiles = ['voiceover-1.txt', 'voiceover-2.txt', 'voiceover-3.txt'];
  
  // Renaming only if the files exist
  try {
    for (let i = 0; i < 3; i++) {
      const bRollOldPath = path.join(dir, bRollFiles[i]);
      const bRollNewPath = path.join(dir, `${i + 1}.png`);
      if (fs.existsSync(bRollOldPath)) {
        fs.renameSync(bRollOldPath, bRollNewPath);
      } else {
        console.error('File not found:', bRollOldPath);
      }

      const voiceoverOldPath = path.join(dir, voiceoverFiles[i]);
      const voiceoverNewPath = path.join(dir, `${i + 1}.mp3`);
      if (fs.existsSync(voiceoverOldPath)) {
        fs.renameSync(voiceoverOldPath, voiceoverNewPath);
      }

      const transcriptionOldPath = path.join(dir, transcriptionFiles[i]);
      const transcriptionNewPath = path.join(dir, `transcription-${i + 1}.json`);
      if (fs.existsSync(transcriptionOldPath)) {
        fs.renameSync(transcriptionOldPath, transcriptionNewPath);
      } else {
        console.error('Transcription file not found:', transcriptionOldPath);
      }
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'File renaming failed', error: err.message });
  }

  const images = ['1.png', '2.png', '3.png'];
  const audio = ['1.mp3', '2.mp3', '3.mp3'];
  const transcriptions = ['transcription-1.json', 'transcription-2.json', 'transcription-3.json'];

  try {
    await Promise.all(images.map(async (image, i) => {
      const inputImage = path.join(dir, images[i]);
      const inputAudio = path.join(dir, audio[i]);
      const inputTranscription = path.join(dir, transcriptions[i]);
      const outputVideo = path.join(dir, `output_${i}.mp4`);

      if (!fs.existsSync(inputImage) || !fs.existsSync(inputAudio) || !fs.existsSync(inputTranscription)) {
        console.error(`Missing files for video segment ${i + 1}:`, {
          image: inputImage,
          audio: inputAudio,
          transcription: inputTranscription
        });
        return; // Skip this segment if any file is missing
      }

      // read the transcription file
      const transcription = JSON.parse(fs.readFileSync(inputTranscription, 'utf8'));
      const words = transcription.words;
      const duration = parseFloat(transcription.duration).toFixed(2);

      // Build the drawtext filter string
      let drawtextFilter = '';
      words.forEach((wordInfo) => {
        const word = wordInfo.word.replace(/'/g, "\\'").replace(/"/g, '\\"');
        const start = parseFloat(wordInfo.start).toFixed(2);
        const end = parseFloat(wordInfo.end).toFixed(2);
        drawtextFilter += `drawtext=text='${word}':fontcolor=white:fontsize=96:borderw=4:bordercolor=black:x=(w-text_w)/2:y=(h*3/4)-text_h:enable='between(t\\,${start}\\,${end})',`;
      });
      // remove last comma
      drawtextFilter = drawtextFilter.slice(0, -1);

      console.log(`Processing: ${inputImage} and ${inputAudio}`);

      await new Promise((resolve, reject) => {
        ffmpeg()
          .input(inputImage)
          .loop(duration)
          .input(inputAudio)
          .audioCodec('copy')
          .videoFilter(drawtextFilter)
          .outputOptions('-t', duration)
          .on('error', (e) => {
            console.error(e);
            reject(e);
          })
          .on('end', resolve)
          .save(outputVideo);
      });

      console.log(`${outputVideo} is complete`);
    }));

    console.log('Merging videos together');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(dir, 'output_0.mp4'))
        .input(path.join(dir, 'output_1.mp4'))
        .input(path.join(dir, 'output_2.mp4'))
        .on('end', resolve)
        .on('error', reject)
        .mergeToFile(path.join(dir, 'final.mp4'));
    });

    console.log('done');
    return res.json(`${id}/final.mp4`);
  } catch (error) {
    console.error('Video processing failed:', error);
    return res.status(500).json({ message: 'Video processing failed', error: error.message });
  }
});

app.get('/samples', (req, res) => {
  const stories = fs.readdirSync('./stories').filter((dir) => {
    return dir.match(/^[a-z0-9]{6,}$/) && fs.existsSync(`./stories/${dir}/final.mp4`);
  });
  res.json(stories);
});

app.listen(8080, () => console.log('Listening on port 8080'));