console.log("🔥 FILE STARTED")
import { GroqService } from "../main/services/llm/GroqService"
import "dotenv/config"

async function test() {
    const groq = new GroqService(process.env.GROQ_API_KEY!)

    try {
        const res = await groq.generateAnswer({
            transcript: "We are discussing Redis vs MongoDB for caching. Which one should we use?",
            systemPrompt: "You are a helpful assistant. Answer clearly in 2-3 sentences.",
        })

        console.log("✅ GROQ RESPONSE:\n", res)
    } catch (err: any) {
        console.error("❌ GROQ ERROR:", err.message)
    }
}

test()