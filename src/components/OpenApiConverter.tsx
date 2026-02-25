import React, { useState } from "react";
import yaml from "js-yaml";

// --- 1. Types and utils ---
type Spec = Record<string, any>;

const detectVersion = (spec: Spec): "openapi3" | "swagger2" | "unknown" => {
  if (spec.openapi) return "openapi3";
  if (spec.swagger) return "swagger2";
  return "unknown";
};

// --- 2. Modular Markdown Generation ---
const renderSchemaDetails = (schema: Spec): string => {
  if (!schema) return "";
  if (schema.$ref) return `- ref: ${schema.$ref.split("/").pop()}\n\n`;

  let out = schema.description ? `${schema.description}\n\n` : "";
  const type =
    schema.type ||
    (schema.$ref ? `ref ${schema.$ref.split("/").pop()}` : "object");
  out += `- Type: ${type}\n`;

  const props =
    schema.properties ||
    schema.allOf?.reduce(
      (acc: Spec, s: Spec) => ({ ...acc, ...(s.properties || {}) }),
      {},
    ) ||
    null;
  const requiredProps: string[] = schema.required || [];

  if (props && Object.keys(props).length) {
    out += `\n| Property | Type | Required | Description |\n|---|---|---|---|\n`;
    for (const [pname, pschema] of Object.entries(
      props as Record<string, Spec>,
    )) {
      let ptype =
        pschema.type ||
        (pschema.$ref ? `ref ${pschema.$ref.split("/").pop()}` : "object");
      if (pschema.format) ptype += ` (${pschema.format})`;
      const preq = requiredProps.includes(pname) ? "✅" : "❌";
      const pdesc = pschema.description || "—";
      out += `| ${pname} | ${ptype} | ${preq} | ${pdesc} |\n`;
    }
    out += `\n`;
  } else {
    out += `\n`;
  }
  return out;
};

const generateMarkdown = (spec: Spec | null): string => {
  if (!spec) return "// No data";
  const version = detectVersion(spec);
  let md = "";

  // Title & Info
  const title = spec.info?.title || "API Specification";
  const ver = spec.info?.version ? ` v${spec.info.version}` : "";
  md += `# ${title}${ver}\n\n`;
  if (spec.info?.description) md += `${spec.info.description}\n\n`;

  // Servers
  md += `## 🌐 Servers\n`;
  if (version === "openapi3" && spec.servers?.length) {
    spec.servers.forEach((s: Spec) => {
      md += `- ${s.url}${s.description ? ` — ${s.description}` : ""}\n`;
    });
  } else if (version === "swagger2" && spec.host) {
    const scheme = spec.schemes?.[0] || "http";
    md += `- ${scheme}://${spec.host}${spec.basePath || ""}\n`;
  } else {
    md += "*not specified*\n";
  }
  md += "\n";

  // Endpoints
  md += `## 🚏 Endpoints\n\n`;
  if (!spec.paths || Object.keys(spec.paths).length === 0) {
    md += "*no paths*\n";
  } else {
    const methods = [
      "get",
      "post",
      "put",
      "delete",
      "patch",
      "options",
      "head",
    ];
    for (const [path, pathItem] of Object.entries(
      spec.paths as Record<string, Spec>,
    )) {
      for (const method of methods) {
        const op = pathItem[method];
        if (!op) continue;

        md += `### \`${method.toUpperCase()}\` ${path}\n`;
        if (op.summary) md += `**${op.summary}** \n`;
        if (op.description && op.description !== op.summary)
          md += `${op.description}  \n`;
        md += "\n";

        // Parameters
        if (op.parameters?.length) {
          md += `**Parameters:**\n\n| Name | In | Type | Req. | Description |\n|-----|--------------|-----|---------|----------|\n`;
          op.parameters.forEach((p: Spec) => {
            let type = p.schema?.type || p.type || "—";
            const req = p.required ? "✅" : "❌";
            md += `| ${p.name || ""} | ${p.in || ""} | ${type} | ${req} | ${p.description || "—"} |\n`;
          });
          md += "\n";
        }
      }
    }
  }

  // Components / Definitions
  const schemas = spec.components?.schemas || spec.definitions;
  if (schemas && Object.keys(schemas).length) {
    md += `## 📦 Schemas\n`;
    for (const [name, schema] of Object.entries(
      schemas as Record<string, Spec>,
    )) {
      md += `### ${name}\n${renderSchemaDetails(schema)}`;
    }
  }

  return md;
};

// --- 3. REACT Component ---
export default function OpenApiConverter() {
  const [url, setUrl] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [fileName, setFileName] = useState("No file chosen");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pastedText, setPastedText] = useState("");

  const processRawData = (rawText: string, sourceName: string) => {
    try {
      let parsed: Spec;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = yaml.load(rawText) as Spec;
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid format");
      }

      setMarkdown(generateMarkdown(parsed));
      setFileName(sourceName);
      setError("");
    } catch (err) {
      setError("Failed to parse: Must be valid JSON or YAML.");
      setMarkdown("");
    }
  };

  const fetchFromUrl = async (targetUrl: string) => {
    if (!targetUrl.trim()) {
      setError("Enter a valid URL");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(targetUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      processRawData(text, targetUrl);
    } catch (err: any) {
      setError(`Loading error: ${err.message} (CORS issue?)`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      processRawData(content, file.name);
    };
    reader.onerror = () => setError("File read error");
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      alert("Copied to clipboard!");
    } catch {
      alert("Failed to copy");
    }
  };

  const handleDownload = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "api-spec.md";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const clearAll = () => {
    setUrl("");
    setPastedText("");
    setMarkdown("");
    setFileName("No file chosen");
    setError("");
  };

  return (
    <div>
      {/* URL Section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">🔗 Load from URL</h2>
        <div className="flex gap-2">
          <input
            type="url"
            className="flex-1 border border-gray-300 rounded px-3 py-2 focus:ring-2 focus:ring-blue-400 focus:outline-none"
            placeholder="https://petstore.swagger.io/v2/swagger.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchFromUrl(url)}
          />
          <button
            onClick={() => fetchFromUrl(url)}
            disabled={loading}
            className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
        <div className="mt-2 text-sm text-gray-500">
          Example:{" "}
          <button
            className="text-blue-600 hover:underline"
            onClick={() => {
              const exUrl = "https://petstore.swagger.io/v2/swagger.json";
              setUrl(exUrl);
              fetchFromUrl(exUrl);
            }}
          >
            Petstore (Swagger 2.0)
          </button>
        </div>
      </div>

      {/* Paste Section */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">✏️ Paste specification</h2>
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="Paste JSON or YAML here..."
          className="w-full border border-gray-300 rounded px-3 py-2 h-32 resize-y focus:ring-2 focus:ring-blue-400 focus:outline-none font-mono text-sm"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => processRawData(pastedText, "Pasted text")}
            disabled={!pastedText.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Process Text
          </button>
        </div>
      </div>

      {/* File Upload Section */}
      <div className="mb-6 flex items-center gap-4">
        <h2 className="text-lg font-semibold m-0">📁 Or upload file:</h2>
        <label className="cursor-pointer bg-gray-100 border border-gray-300 rounded px-4 py-2 hover:bg-gray-200 transition-colors text-sm font-medium">
          <span>Choose JSON/YAML</span>
          <input
            type="file"
            accept=".json,.yaml,.yml"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
        <span className="text-sm text-gray-500">{fileName}</span>
      </div>

      {/* Error Output */}
      {error && (
        <div className="mb-6 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md flex items-center gap-2">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* Markdown Result */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold">📝 Markdown Output</h2>
          {markdown && (
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="text-sm bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 transition-colors"
              >
                📋 Copy
              </button>
              <button
                onClick={handleDownload}
                className="text-sm bg-gray-700 text-white px-3 py-1.5 rounded hover:bg-gray-800 transition-colors"
              >
                ⬇️ Download
              </button>
            </div>
          )}
        </div>
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-auto h-96 font-mono text-sm whitespace-pre-wrap border border-gray-800 shadow-inner">
          {markdown || "// Generated Markdown will appear here..."}
        </pre>
      </div>

      {/* Global Actions */}
      <div className="flex justify-end">
        <button
          onClick={clearAll}
          className="text-sm text-red-600 hover:text-red-800 font-medium px-4 py-2"
        >
          🗑️ Clear Everything
        </button>
      </div>
    </div>
  );
}
