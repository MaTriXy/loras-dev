import Together, { ClientOptions } from "together-ai";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";
import { Lora, LORAS } from "@/data/loras";

let ratelimit: Ratelimit | undefined;

// Add rate limiting if Upstash API keys are set, otherwise skip
if (process.env.UPSTASH_REDIS_REST_URL) {
  ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    // Allow 10 requests per day, then need to use API key
    limiter: Ratelimit.fixedWindow(10, "1440 m"),
    analytics: true,
    prefix: "loras-dev",
  });
}

let requestSchema = z.object({
  prompt: z.string(),
  lora: z.string(),
  seed: z.number(),
  userAPIKey: z.string().optional(),
});

export async function POST(req: Request) {
  let json = await req.json();
  let { prompt, userAPIKey, lora, seed } = requestSchema.parse(json);

  const options: ClientOptions = {
    ...(userAPIKey ? { apiKey: userAPIKey } : {}),
    ...(process.env.HELICONE_API_KEY
      ? {
          baseURL: "https://together.helicone.ai/v1",
          defaultHeaders: {
            "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
            "Helicone-Property-BYOK": userAPIKey ? "true" : "false",
            "Helicone-Property-appname": "LorasDev",
          },
        }
      : {}),
  };
  const client = new Together(options);

  if (ratelimit && !userAPIKey) {
    const identifier = await getIPAddress();
    const { success } = await ratelimit.limit(identifier);
    if (!success) {
      return Response.json(
        "No requests left. Please add your own API key or try again in 24h.",
        {
          status: 429,
        },
      );
    }
  }

  const selectedLora = LORAS.find((l) => l.model === lora);
  if (!selectedLora) {
    return Response.json(
      { error: `Missing lora: ${lora}` },
      {
        status: 404,
      },
    );
  }

  const refinedPrompt = await refinePrompt({
    prompt,
    lora: selectedLora,
    client,
  });

  let response;
  try {
    response = await client.images.generate({
      prompt: refinedPrompt,
      model: "black-forest-labs/FLUX.1-dev-lora",
      height: selectedLora.height ?? 768,
      width: selectedLora.width ?? 1024,
      seed,
      steps: selectedLora.steps,
      response_format: "base64",
      image_loras: [
        {
          path: selectedLora.path,
          scale: selectedLora.scale,
        },
      ],
    });
  } catch (e: unknown) {
    console.log(e);
    return Response.json(
      { error: e instanceof Error ? e.toString() : "Unknown error" },
      {
        status: 500,
      },
    );
  }

  return Response.json({
    prompt: refinedPrompt,
    image: response.data[0],
  });
}

export const runtime = "edge";

const FALLBACK_IP_ADDRESS = "0.0.0.0";
async function getIPAddress() {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0] ?? FALLBACK_IP_ADDRESS;
  }

  return h.get("x-real-ip") ?? FALLBACK_IP_ADDRESS;
}

async function refinePrompt({
  prompt,
  lora,
  client,
}: {
  prompt: string;
  lora: Lora;
  client: Together;
}) {
  if (!lora.refinement) {
    return lora.applyTrigger(prompt);
  }

  try {
    let res = await client.chat.completions.create({
      model: "Qwen/Qwen2.5-7B-Instruct-Turbo",
      messages: [
        {
          role: "system",
          content: `Your task is to help refine prompts that will be passed to an image generation model. ${lora.refinement}. Only respond with the improved prompt and nothing else. Be as terse as possible, do not include quotes.`,
        },
        {
          role: "user",
          content: `Write a more detailed prompt about "${prompt}"`,
        },
      ],
    });

    let improved = res.choices[0].message?.content ?? prompt;
    return lora.applyTrigger(improved);
  } catch (e) {
    console.log("Error refining prompt", e);
    return lora.applyTrigger(prompt);
  }
}
