// src/main/services/stt/KeywordExtractor.ts
import fs from "fs"
import path from "path"

const MAX_KEYWORDS = 30

// Common English words to filter out — not useful as technical keywords
const STOP_WORDS = new Set([
    "The", "This", "That", "These", "Those", "With", "From", "Into", "Over",
    "Under", "After", "Before", "Between", "Through", "During", "Without",
    "About", "Against", "Along", "Around", "Because", "Before", "Behind",
    "Below", "Beside", "Besides", "Beyond", "But", "By", "Down", "Each",
    "For", "From", "Here", "How", "If", "In", "Into", "Is", "It", "Its",
    "Just", "Like", "More", "Most", "Not", "Now", "Of", "Off", "On", "Or",
    "Our", "Out", "Own", "Same", "So", "Some", "Such", "Than", "Then",
    "There", "They", "To", "Too", "Up", "Very", "Was", "We", "Were",
    "What", "When", "Where", "Which", "While", "Who", "Will", "With",
    "Would", "You", "Your", "And", "Are", "As", "At", "Be", "Been",
    "Can", "Could", "Did", "Do", "Does", "Done", "Get", "Got", "Had",
    "Has", "Have", "He", "Her", "Him", "His", "May", "Me", "My",
    "New", "No", "Nor", "Not", "Object", "Return", "True", "False",
    "Null", "Void", "Any", "All", "Let", "Var", "Const", "Type",
    "String", "Number", "Boolean", "Array", "Error", "Event", "Node",
])

export interface KeywordExtractionResult {
    keywords: string[]
    source: string  // which file was scanned
}

export class KeywordExtractor {
    /**
     * Extract technical keywords from a source file + package.json deps.
     * Returns max 30 unique strings suitable for injecting into an LLM prompt.
     */
    extract(filePath: string): KeywordExtractionResult {
        const keywords = new Set<string>()

        // ── 1. Scan the active source file ───────────────────
        if (filePath && fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8")
            this.extractFromSource(content, keywords)
        }

        // ── 2. Add deps from package.json ────────────────────
        const pkgPath = this.findPackageJson(filePath)
        if (pkgPath) {
            this.extractFromPackageJson(pkgPath, keywords)
        }

        const result = Array.from(keywords)
            .filter(k => k.length >= 2 && k.length <= 40)
            .slice(0, MAX_KEYWORDS)

        return {
            keywords: result,
            source: filePath || "(no file)",
        }
    }

    private extractFromSource(content: string, out: Set<string>) {
        // Import statements: extract module names and named imports
        // e.g. import { useState, useEffect } from 'react'
        // e.g. import Groq from 'groq-sdk'
        const importRegex = /import\s+(?:(?:\{([^}]+)\}|(\w+))\s+from\s+)?['"]([^'"]+)['"]/g
        let m: RegExpExecArray | null
        while ((m = importRegex.exec(content)) !== null) {
            // Named imports: { useState, useEffect }
            if (m[1]) {
                m[1].split(",").forEach(name => {
                    const trimmed = name.trim().split(" as ")[0].trim()
                    if (trimmed) out.add(trimmed)
                })
            }
            // Default import: Groq
            if (m[2]) out.add(m[2])
            // Module name: 'groq-sdk' → 'groq-sdk'
            if (m[3]) {
                const mod = m[3].replace(/^[@./]+/, "").split("/")[0]
                if (mod) out.add(mod)
            }
        }

        // PascalCase words — likely class names, types, components
        // e.g. DeepgramService, MeetingAssistant, InputClassifier
        const pascalRegex = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g
        while ((m = pascalRegex.exec(content)) !== null) {
            if (!STOP_WORDS.has(m[1])) out.add(m[1])
        }

        // ALL_CAPS identifiers — likely constants/enums
        // e.g. GROQ_API_KEY, STT_MODE
        const capsRegex = /\b([A-Z][A-Z_]{2,})\b/g
        while ((m = capsRegex.exec(content)) !== null) {
            out.add(m[1])
        }

        // Common React/JS hooks and patterns
        const hookRegex = /\b(use[A-Z]\w+)\b/g
        while ((m = hookRegex.exec(content)) !== null) {
            out.add(m[1])
        }

        // camelCase identifiers that look like API/tech terms (≥8 chars)
        // e.g. generateAnswer, cleanTranscript, startDeepgram
        const camelRegex = /\b([a-z][a-z]+[A-Z]\w{3,})\b/g
        while ((m = camelRegex.exec(content)) !== null) {
            if (m[1].length >= 8) out.add(m[1])
        }
    }

    private extractFromPackageJson(pkgPath: string, out: Set<string>) {
        try {
            const raw = fs.readFileSync(pkgPath, "utf-8")
            const pkg = JSON.parse(raw)
            const deps = {
                ...pkg.dependencies,
                ...pkg.devDependencies,
            }
            Object.keys(deps).forEach(dep => {
                // Convert package names to readable form
                // e.g. "@vitejs/plugin-react" → "plugin-react", "groq-sdk" → "groq-sdk"
                const clean = dep.replace(/^@[^/]+\//, "")
                out.add(clean)
                // Also add PascalCase version for common packages
                // e.g. "react-dom" → "ReactDOM" won't work but "groq" → "Groq"
                const simple = clean.split(/[-_]/)[0]
                if (simple && simple.length >= 3) {
                    out.add(simple.charAt(0).toUpperCase() + simple.slice(1))
                }
            })
        } catch {
            // package.json not found or invalid — skip silently
        }
    }

    private findPackageJson(startPath: string): string | null {
        if (!startPath) return null
        let dir = path.dirname(startPath)
        // Walk up max 5 levels to find package.json
        for (let i = 0; i < 5; i++) {
            const candidate = path.join(dir, "package.json")
            if (fs.existsSync(candidate)) return candidate
            const parent = path.dirname(dir)
            if (parent === dir) break
            dir = parent
        }
        return null
    }
}
