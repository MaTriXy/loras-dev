import { codeToHtml } from "shiki";
import dedent from "dedent";
import { LORAS } from "@/data/loras";

export async function POST(request: Request) {
  const json = await request.json();
  const lora = LORAS.find((l) => l.model === json.lora);

  if (!lora) {
    return new Response("Missing lora", { status: 404 });
  }

  const jsInstall = await text`npm install together-ai`;
  const jsExample = await javascript`
    import Together from "together-ai";

    const client = new Together();
    
    const image = await client.images.generate({
      prompt: \"${json.prompt}\",
      model: "black-forest-labs/FLUX.1-dev-lora",
      height: ${lora.height ?? 768},
      width: ${lora.width ?? 1024},
      seed: ${json.seed},
      steps: ${lora.steps},
      image_loras: [
        {
          path: "${lora.path}",
          scale: ${lora.scale},
        },
      ],
    }); 

    console.log(image.data[0].url);
  `;

  const pythonInstall = await text`pip install together`;
  const pythonExample = await python`
    from together import Together

    image = client.images.generate(
        prompt="${json.prompt}",
        model="black-forest-labs/FLUX.1-dev-lora",
        height=${lora.height ?? 768},
        width=${lora.width ?? 1024},
        seed=${json.seed},
        steps=${lora.steps},
        image_loras=[
            {
                "path": "${lora.path}",
                "scale": ${lora.scale},
            },
        ],
    )

    print(image.data[0].url)
  `;

  const setAPIKey = await shell`
    export TOGETHER_API_KEY="your_api_key_here"
  `;

  return Response.json({
    js: {
      install: jsInstall,
      apiKey: setAPIKey,
      example: jsExample,
    },
    python: {
      install: pythonInstall,
      apiKey: setAPIKey,
      example: pythonExample,
    },
  });
}

async function javascript(strings: TemplateStringsArray, ...values: any[]) {
  const string = extract(strings, ...values);
  return generateCode(string, "javascript");
}

async function python(strings: TemplateStringsArray, ...values: any[]) {
  const string = extract(strings, ...values);
  return generateCode(string, "python");
}

async function shell(strings: TemplateStringsArray, ...values: any[]) {
  const string = extract(strings, ...values);
  return generateCode(string, "shell");
}

async function text(strings: TemplateStringsArray, ...values: any[]) {
  const string = extract(strings, ...values);
  return generateCode(string, "text");
}

function extract(strings: TemplateStringsArray, ...values: any[]) {
  return strings.reduce((result, string, i) => {
    return result + (values[i - 1] || "") + string;
  });
}

async function generateCode(code: string, lang: string) {
  const content = dedent(code);
  const html = await codeToHtml(content, {
    lang,
    theme: "github-dark-default",
  });

  return html;
}
