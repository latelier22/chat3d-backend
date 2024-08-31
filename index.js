import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import fs from "fs"; // Importation du module fs classique
import { promises as fsPromises } from "fs"; // Importation de fs/promises pour les autres opérations
import OpenAI from "openai";
import axios from "axios";
import querystring from 'querystring';
import crypto from 'crypto';
import path from 'path';

dotenv.config();

// Fonction pour générer un nom de fichier unique basé sur un hash de l'URL
function generateUniqueFileName(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  const ext = path.extname(url).split('?')[0]; // Extraire l'extension de fichier
  return `${hash}.png`;
}

// Assurez-vous que l'application Express sert le dossier public

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "EXAVITQu4vr4xnSDxMaL";

const app = express();
app.use(express.json());
app.use(cors());
const port = process.env.PORT || 3000;

const __dirname = path.resolve(); // Si vous utilisez des modules ESM
app.use(express.static(path.join(__dirname, 'public')));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error);
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);
  await execCommand(
    `ffmpeg -y -i audios/message_${message}.mp3 audios/message_${message}.wav`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);
  await execCommand(
    `/usr/local/bin/rhubarb -f json -o audios/message_${message}.json audios/message_${message}.wav -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) {
    res.send({
      messages: [
        {
          text: "Hey dear... How was your day?",
          audio: await audioFileToBase64("audios/intro_0.wav"),
          lipsync: await readJsonTranscript("audios/intro_0.json"),
          facialExpression: "smile",
          animation: "Talking_1",
        },
        {
          text: "I missed you so much... Please don't go for so long!",
          audio: await audioFileToBase64("audios/intro_1.wav"),
          lipsync: await readJsonTranscript("audios/intro_1.json"),
          facialExpression: "sad",
          animation: "Crying",
        },
      ],
    });
    return;
  }
  if (!elevenLabsApiKey || openai.apiKey === "-") {
    res.send({
      messages: [
        {
          text: "Please my dear, don't forget to add your API keys!",
          audio: await audioFileToBase64("audios/api_0.wav"),
          lipsync: await readJsonTranscript("audios/api_0.json"),
          facialExpression: "angry",
          animation: "Angry",
        },
        {
          text: "You don't want to ruin Wawa Sensei with a crazy ChatGPT and ElevenLabs bill, right?",
          audio: await audioFileToBase64("audios/api_1.wav"),
          lipsync: await readJsonTranscript("audios/api_1.json"),
          facialExpression: "smile",
          animation: "Laughing",
        },
      ],
    });
    return;
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-1106",
    max_tokens: 1000,
    temperature: 0.6,
    messages: [
      {
        role: "system",
        content: `
        You are a virtual girlfriend.
        You will always reply with a JSON array of messages. With a maximum of 3 messages.
        Each message has a text, facialExpression, and animation property.
        The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
        The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
        `,
      },
      {
        role: "user",
        content: userMessage || "Hello",
      },
    ],
  });

  let messages = JSON.parse(completion.choices[0].message.content);
  if (messages.messages) {
    messages = messages.messages;
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const fileName = `audios/message_${i}.mp3`;
    const textInput = message.text;
    await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);
    await lipSyncMessage(i);
    message.audio = await audioFileToBase64(fileName);
    message.lipsync = await readJsonTranscript(`audios/message_${i}.json`);
  }

  res.send({ messages });
});

const readJsonTranscript = async (file) => {
  const data = await fsPromises.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fsPromises.readFile(file);
  return data.toString("base64");
};

// Fonction pour télécharger l'image et la sauvegarder localement
const downloadImage = async (url, filepath) => {
  const response = await axios({
    url,
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    response.data
      .pipe(fs.createWriteStream(filepath))
      .on('finish', () => resolve())
      .on('error', e => reject(e));
  });
};

app.post("/image", async (req, res) => {
  const description = req.body.description;

  if (!description) {
    return res.status(400).send({ error: "Description is required" });
  }

  try {
    // Génération de l'image avec OpenAI
    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: description,
      n: 1,
      size: "1024x1024",
    });

    const imageUrl = response.data[0].url;
    
    // Générer un nom de fichier unique
    const uniqueFileName = generateUniqueFileName(imageUrl);
    const localFilePath = `./public/textures/${uniqueFileName}`; // Chemin local pour enregistrer l'image

    // Télécharger l'image et l'enregistrer localement
    await downloadImage(imageUrl, localFilePath);
    console.log('Image downloaded successfully');

    res.send({ imagePath: `/textures/${uniqueFileName}` });  // Renvoi du chemin local de l'image au client
  } catch (error) {
    console.error("Error generating image:", error);
    res.status(500).send({ error: "Failed to generate image" });
  }
});

// Endpoint Google Search
// ... autres importations


app.post("/googleSearch", async (req, res) => {
  const { searchTerm, page = 1 } = req.body;
  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_CX;
  
  if (!searchTerm || !apiKey || !cx) {
    return res.status(400).send({ error: "Search term, API key, and CX are required" });
  }

  const startIndex = (page - 1) * 10 + 1;

  const params = {
    q: searchTerm,
    cx,
    searchType: 'image',
    key: apiKey,
    start: startIndex,
  };

  const url = `https://customsearch.googleapis.com/customsearch/v1?${querystring.stringify(params)}`;

  try {
    const response = await axios.get(url);
    const imageUrls = response.data.items.map(item => item.link);
    const totalResults = parseInt(response.data.searchInformation.totalResults, 10);
    const totalPages = Math.ceil(totalResults / 10);

    res.send({ imageUrls, totalPages });
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).send({ error: "Failed to fetch images" });
  }
});


app.post("/downloadImage", async (req, res) => {
  const imageUrl = req.body.imageUrl;

  if (!imageUrl) {
    return res.status(400).send({ error: "Image URL is required" });
  }

  try {
    const uniqueFileName = generateUniqueFileName(imageUrl);
    const localFilePath = `./public/textures/${uniqueFileName}`;

    // Télécharger l'image et l'enregistrer localement
    await downloadImage(imageUrl, localFilePath);
    console.log('Image downloaded successfully ',imageUrl);

    res.send({ imagePath: `/textures/${uniqueFileName}` });  // Retourne le chemin de l'image stockée localement
  } catch (error) {
    console.error("Error downloading image:", error);
    res.status(500).send({ error: "Failed to download image" });
  }
});



app.listen(port, () => {
  console.log(`Virtual Girlfriend listening on port ${port}`);
});
