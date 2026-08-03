import { AgentBuilder } from "@iqai/adk";

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (!key || key.includes("your_gemini_api_key") || key.trim() === "") {
    return null;
  }
  const cleanKey = key.trim();
  process.env.GOOGLE_API_KEY = cleanKey;
  process.env.GEMINI_API_KEY = cleanKey;
  return cleanKey;
}

function handleAiError(err) {
  const msg = typeof err === "string" ? err : (err.message || "");
  if (msg.includes("401") || msg.includes("UNAUTHENTICATED") || msg.includes("invalid authentication credentials")) {
    return "Invalid Gemini API Key: Please verify your GEMINI_API_KEY in your .env file.";
  }
  if (msg.includes("Quota exceeded") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
    return "Gemini API Rate Limit: Rate limit reached. Free tier resets every 60 seconds. Please try again shortly!";
  }
  return `ADK Agent Notice: ${msg}`;
}

async function askAgentWithFallback(prompt, instruction) {
  const models = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-2.0-flash"];
  let lastError = null;

  for (const model of models) {
    try {
      const response = await AgentBuilder
        .withModel(model)
        .withInstruction(instruction)
        .ask(prompt);
      
      const resStr = String(response || "").trim();
      if (resStr && !resStr.startsWith("Error:") && !resStr.includes('"code":429') && !resStr.includes('"code":401')) {
        return resStr;
      }
      lastError = resStr;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(typeof lastError === "string" ? lastError : lastError.message);
}

export async function generateArticleWithAgent(topic) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: "AI Key Not Configured: Please add your GEMINI_API_KEY from Google AI Studio to your .env file."
    };
  }

  try {
    const prompt = `You are an expert, versatile blog author on ThoughtHub. Write an engaging, well-structured article based on the following topic/title prompt: "${topic}".

STRICT DOMAIN ADAPTATION RULES:
1. Detect the core theme and domain of the user's prompt (e.g. Movies/TV, Pop Culture, Philosophy, Personal Growth, Lifestyle, Art, Technology, Science).
2. DO NOT turn non-technical prompts into software development or coding articles. If a prompt mentions a show, character, movie, book, or non-tech concept (e.g. BoJack Horseman, Cinema, Cooking, Travel, Philosophy), write authentically about that specific subject!
3. Only include code blocks or technical terms if the prompt is explicitly about programming, software engineering, or computer science.

Return ONLY a valid raw JSON object without markdown code block fencing, with the exact keys:
"title": string (an engaging, authentic title matching the prompt),
"category": string (one of: Technology, Design, Development, Lifestyle, General, Entertainment, Culture, Philosophy),
"content": string (detailed body content written in Markdown with headings #, ##, bold text, bullet points, and quotes).`;

    const responseStr = await askAgentWithFallback(
      prompt,
      "You output clean structured JSON responses for multi-domain blog posts."
    );

    let cleanJson = responseStr;
    if (cleanJson.startsWith("```json")) {
      cleanJson = cleanJson.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```/, "").replace(/```$/, "").trim();
    }

    let parsed = null;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      const match = cleanJson.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error(`AI generated non-JSON response: ${responseStr.substring(0, 100)}...`);
      }
    }

    return {
      success: true,
      title: parsed.title || topic,
      category: parsed.category || "General",
      content: parsed.content || ""
    };
  } catch (err) {
    console.error("[ADK-TS Article Generator Error]:", err.message);
    return {
      success: false,
      error: handleAiError(err)
    };
  }
}

export async function summarizeArticleWithAgent(title, content) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: "AI Key Not Configured: Please add your GEMINI_API_KEY to your .env file."
    };
  }

  try {
    const prompt = `Summarize the following blog post into 3 clear, punchy bullet points representing the main takeaways:
Title: ${title}
Content: ${content}`;

    const responseStr = await askAgentWithFallback(
      prompt,
      "You are an executive content summarizer. Format your takeaways directly as a bulleted markdown list with bold lead-ins."
    );

    return {
      success: true,
      summary: responseStr
    };
  } catch (err) {
    console.error("[ADK-TS Article Summarizer Error]:", err.message);
    return {
      success: false,
      error: handleAiError(err)
    };
  }
}

export async function polishArticleWithAgent(content) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: "AI Key Not Configured: Please add your GEMINI_API_KEY to your .env file."
    };
  }

  try {
    const prompt = `Refine and polish the following blog post content. Fix grammar errors, improve flow, and enhance markdown styling without altering the original meaning:
${content}`;

    const responseStr = await askAgentWithFallback(
      prompt,
      "You are a professional editor. Enhance tone and markdown formatting."
    );

    return {
      success: true,
      content: responseStr
    };
  } catch (err) {
    console.error("[ADK-TS Article Polisher Error]:", err.message);
    return {
      success: false,
      error: handleAiError(err)
    };
  }
}
