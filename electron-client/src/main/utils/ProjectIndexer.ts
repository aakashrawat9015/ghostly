// src/main/utils/ProjectIndexer.ts
import fs from "fs"
import path from "path"
import { glob } from "glob"

const DEBUG = process.env.DEBUG_LLM === "true"

export interface SymbolEntry {
    name: string
    filePath: string
    kind: "class" | "interface" | "function" | "const" | "type" | "enum"
}

export class ProjectIndexer {
    private symbolMap = new Map<string, SymbolEntry>()
    private indexed = false

    async indexProject(rootPath: string): Promise<void> {
        this.symbolMap.clear()

        const files = await glob("**/*.{ts,tsx,js,jsx}", {
            cwd: rootPath,
            ignore: ["node_modules/**", "dist/**", ".git/**", "**/*.d.ts"],
            absolute: true,
        })

        for (const fullPath of files) {
            try {
                const content = fs.readFileSync(fullPath, "utf-8")
                this.extractSymbols(content, fullPath)
            } catch {
                // unreadable file — skip
            }
        }

        this.indexed = true
        if (DEBUG) console.log(`[ProjectIndexer] Indexed ${this.symbolMap.size} symbols from ${files.length} files`)
        else console.log(`[ProjectIndexer] ✅ ${this.symbolMap.size} symbols indexed`)
    }

    private extractSymbols(content: string, filePath: string) {
        // exported declarations: class, interface, function, const, type, enum
        const exportRegex = /export\s+(?:default\s+)?(?:abstract\s+)?(class|interface|function|const|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
        let m: RegExpExecArray | null
        while ((m = exportRegex.exec(content)) !== null) {
            const kind = m[1] as SymbolEntry["kind"]
            const name = m[2]
            if (!this.symbolMap.has(name)) {
                this.symbolMap.set(name, { name, filePath, kind })
            }
        }

        // Also grab non-exported PascalCase class/interface names — useful for correction
        const classRegex = /\b(class|interface)\s+([A-Z][A-Za-z0-9_$]+)/g
        while ((m = classRegex.exec(content)) !== null) {
            const name = m[2]
            if (!this.symbolMap.has(name)) {
                this.symbolMap.set(name, { name, filePath, kind: m[1] as "class" | "interface" })
            }
        }
    }

    /**
     * Given a raw transcript, find which known symbols appear in it (fuzzy match).
     * Returns the matching SymbolEntry list.
     */
    findMentionedSymbols(transcript: string): SymbolEntry[] {
        const lower = transcript.toLowerCase()
        const results: SymbolEntry[] = []

        for (const entry of this.symbolMap.values()) {
            // Exact case-insensitive match
            if (lower.includes(entry.name.toLowerCase())) {
                results.push(entry)
            }
        }

        return results
    }

    /**
     * Get all symbol names — used to build keyword lists for correction prompts.
     */
    getAllSymbolNames(): string[] {
        return Array.from(this.symbolMap.keys())
    }

    getFileForSymbol(name: string): string | null {
        return this.symbolMap.get(name)?.filePath ?? null
    }

    get isIndexed(): boolean {
        return this.indexed
    }

    get symbolCount(): number {
        return this.symbolMap.size
    }

    /**
     * Lightweight injection — used in worker threads where we can't run glob.
     * Main process indexes the project and sends the symbol names here.
     * File paths are unknown in this mode, so code snippets won't be available,
     * but symbol names are still used for keyword-based correction.
     */
    injectSymbols(names: string[]): void {
        for (const name of names) {
            if (!this.symbolMap.has(name)) {
                this.symbolMap.set(name, { name, filePath: "", kind: "const" })
            }
        }
        this.indexed = true
    }
}
