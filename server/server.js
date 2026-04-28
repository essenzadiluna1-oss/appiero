import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

app.use(cors({
  origin: allowedOrigin === "*" ? "*" : [allowedOrigin]
}));

app.use(express.json({ limit: "15mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function safeJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Risposta AI non in formato JSON");
    return JSON.parse(match[0]);
  }
}

app.get("/", (req, res) => {
  res.json({
    app: "ApPiero AI Server",
    status: "ok"
  });
});
app.post("/api/recognize-cultivar", async (req, res) => {

  try {
    const {
      leafImageBase64,
      fruitImageBase64,
      treeImageBase64,
      place,
      season,
      oliveShape,
      oliveSize,
      treeHabit,
      notes
    } = req.body;

    const images = [];

    if (leafImageBase64 && String(leafImageBase64).startsWith("data:image")) {
      images.push({
        type: "input_image",
        image_url: leafImageBase64,
        detail: "auto"
      });
    }

    if (fruitImageBase64 && String(fruitImageBase64).startsWith("data:image")) {
      images.push({
        type: "input_image",
        image_url: fruitImageBase64,
        detail: "auto"
      });
    }

    if (treeImageBase64 && String(treeImageBase64).startsWith("data:image")) {
      images.push({
        type: "input_image",
        image_url: treeImageBase64,
        detail: "auto"
      });
    }

    if (!images.length) {
      return res.status(400).json({
        error: "Serve almeno una foto per riconoscere la cultivar"
      });
    }

    const prompt = `
Devi aiutare un potatore a riconoscere in modo indicativo la cultivar/tipo di olivo.

Contesto:
- Luogo / comune / zona: ${place || "non indicato"}
- Periodo dell'anno: ${season || "non indicato"}
- Forma oliva: ${oliveShape || "non indicata"}
- Dimensione oliva: ${oliveSize || "non indicata"}
- Portamento pianta: ${treeHabit || "non indicato"}
- Note potatore: ${notes || "nessuna"}

Foto disponibili:
- Foglia: ${leafImageBase64 ? "sì" : "no"}
- Frutto/oliva: ${fruitImageBase64 ? "sì" : "no"}
- Pianta/chioma: ${treeImageBase64 ? "sì" : "no"}

Regole:
- Non dare mai certezza assoluta.
- Il risultato deve essere indicativo.
- Usa cultivar italiane quando plausibili: Leccino, Frantoio, Moraiolo, Pendolino, Coratina, Ogliarola, Nocellara, Taggiasca, Carolea, Itrana, Ascolana, Cellina, Maiatica, Rotondella o altre se coerenti.
- Valuta forma foglia, colore foglia, portamento, dimensione frutto, forma frutto, maturazione, zona geografica.
- Se le foto non bastano, dillo chiaramente.
- Dai alternative possibili.
- Spiega cosa fotografare meglio per aumentare precisione.

Rispondi SOLO con JSON valido:

{
  "mostLikelyCultivar": "",
  "confidence": "bassa | media | alta",
  "alternatives": [],
  "visualReasons": [],
  "fieldReasons": [],
  "missingPhotos": [],
  "whatToPhotographBetter": [],
  "shortAdvice": "",
  "warning": "Riconoscimento indicativo da foto e dati di campo. Non sostituisce un agronomo o analisi varietale."
}
`;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            },
            ...images
          ]
        }
      ]
    });

    const json = safeJsonFromText(response.output_text || "");

    res.json({
      mostLikelyCultivar: json.mostLikelyCultivar || "Non determinata",
      confidence: json.confidence || "bassa",
      alternatives: Array.isArray(json.alternatives) ? json.alternatives : [],
      visualReasons: Array.isArray(json.visualReasons) ? json.visualReasons : [],
      fieldReasons: Array.isArray(json.fieldReasons) ? json.fieldReasons : [],
      missingPhotos: Array.isArray(json.missingPhotos) ? json.missingPhotos : [],
      whatToPhotographBetter: Array.isArray(json.whatToPhotographBetter) ? json.whatToPhotographBetter : [],
      shortAdvice: json.shortAdvice || "",
      warning: json.warning || "Riconoscimento indicativo da foto e dati di campo. Non sostituisce un agronomo o analisi varietale."
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Riconoscimento cultivar non riuscito",
      detail: String(err.message || err)
    });
  }
});
app.post("/api/analyze-olive", async (req, res) => {
  try {
    const { imageBase64, cultivar, place, photoPart, notes } = req.body;

    if (!imageBase64 || !String(imageBase64).startsWith("data:image")) {
      return res.status(400).json({
        error: "Foto mancante o formato non valido"
      });
    }

    const prompt = `
Analizza la foto di un olivo per uso agronomico di campo.

Contesto:
- Coltura: olivo
- Cultivar: ${cultivar || "non indicata"}
- Luogo: ${place || "non indicato"}
- Parte fotografata: ${photoPart || "non indicata"}
- Note potatore: ${notes || "nessuna"}

Regole:
- Non dare diagnosi certe.
- Non sostituire agronomo, laboratorio o servizio fitosanitario.
- Se la foto non è chiara, dillo.
- Riconosci solo segnali visibili.
- Valuta foglie gialle, rami secchi, macchie, licheni, muschio, patine, corteccia alterata, insetti visibili, chioma fitta, stress idrico apparente.
- Per Xylella, verticilliosi, rogna, funghi o carenze nutrizionali usa parole come "possibile", "compatibile con", "da verificare".

Rispondi SOLO con JSON valido:

{
  "condition": "Buona | Media | Da controllare | Grave",
  "priority": "Bassa | Media | Alta | Urgente",
  "confidence": "bassa | media | alta",
  "visibleSymptoms": [],
  "suspectedProblems": [],
  "advice": "",
  "cureAdvice": "",
  "nextCheckDays": 15,
  "needsAgronomist": false,
  "photoQuality": "buona | media | scarsa",
  "warning": "Analisi indicativa da foto. Non sostituisce agronomo, laboratorio o servizio fitosanitario."
}
`;

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageBase64, detail: "auto" }
          ]
        }
      ]
    });

    const json = safeJsonFromText(response.output_text || "");

    res.json({
      condition: json.condition || "Da controllare",
      priority: json.priority || "Media",
      confidence: json.confidence || "bassa",
      visibleSymptoms: Array.isArray(json.visibleSymptoms) ? json.visibleSymptoms : [],
      suspectedProblems: Array.isArray(json.suspectedProblems) ? json.suspectedProblems : [],
      advice: json.advice || "",
      cureAdvice: json.cureAdvice || "",
      nextCheckDays: Number(json.nextCheckDays || 15),
      needsAgronomist: Boolean(json.needsAgronomist),
      photoQuality: json.photoQuality || "media",
      warning: json.warning || "Analisi indicativa da foto. Non sostituisce agronomo, laboratorio o servizio fitosanitario."
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Analisi AI non riuscita",
      detail: String(err.message || err)
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`ApPiero AI server attivo su porta ${port}`);
});
