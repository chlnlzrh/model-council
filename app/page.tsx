export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          <h1 className="text-xs font-bold text-black dark:text-white">
            Model Council
          </h1>
          <p className="text-xs text-gray-500">
            Multiple AI models respond, rank each other, and a chairman synthesizes the best answer.
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-xs font-bold text-black dark:text-white">
            API Endpoint
          </h2>
          <code className="rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            POST /api/council/stream
          </code>

          <h2 className="text-xs font-bold text-black dark:text-white">
            Default Council
          </h2>
          <ul className="flex flex-col gap-1">
            {[
              "Claude Opus 4.6",
              "OpenAI o3",
              "Gemini 2.5 Pro",
              "DeepSeek R1",
              "Perplexity Sonar Pro",
            ].map((model) => (
              <li key={model} className="text-xs text-gray-500">
                {model}
              </li>
            ))}
          </ul>

          <h2 className="text-xs font-bold text-black dark:text-white">
            Example
          </h2>
          <pre className="overflow-x-auto rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
{`curl -N -X POST /api/council/stream \\
  -H "Content-Type: application/json" \\
  -d '{"question": "Your question here"}'`}
          </pre>
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-xs font-bold text-black dark:text-white">
            Pipeline
          </h2>
          <div className="flex flex-col gap-1">
            {[
              "Stage 1 — Council models respond in parallel",
              "Stage 2 — Models anonymously rank each other",
              "Stage 3 — Chairman synthesizes final answer",
            ].map((stage) => (
              <p key={stage} className="text-xs text-gray-500">
                {stage}
              </p>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
