const contents = await Deno.readTextFile("td_api.tl");

let lines = contents.split("\n");
lines = lines.filter((v) => v); // remove empty lines
lines = lines.slice(9); // skip to the actual declarations

const parts = new Array<string[]>();
let part = parts[parts.length] ??= [];
for (const line of lines) {
  part.push(line);
  const last = part[part.length - 1];
  if (!last.startsWith("//") && last.endsWith(";")) {
    part = parts[parts.length] ??= [];
  }
}

let classes = `// This was generated. Do not edit.
// deno-lint-ignore-file
// deno-fmt-ignore-file

export class Class {
}

`;

const resolveType = (t: string, p: string): string => {
  const map: Record<string, string> = {
    double: "number",
    string: "string",
    int32: "number",
    int53: "number",
    int64: "number",
    bytes: "string",
    Bool: "boolean",
  };
  if (t in map) {
    return map[t];
  }
  const match = t.match(/^vector<(.+)>$/)?.[1];
  if (match) {
    return `${resolveType(match, p)}[]`;
  }
  return p + t[0].toUpperCase() + t.slice(1);
};

function getEntry(line: string, typePrefix = "") {
  let parts = line.split(/\s/);
  parts = parts.filter((v) => v != "=");
  const unmodifiedName = parts[0];
  const name = unmodifiedName[0].toUpperCase() + unmodifiedName.slice(1);
  parts = parts.slice(1);
  const right = parts[parts.length - 1].slice(0, -1);
  parts = parts.slice(0, -1);
  let parameters = parts.map((v) => v.split(":"));
  parameters = parameters.sort((a, b) => a[0].localeCompare(b[0]));
  parameters = parameters.map((v) => [
    v[0],
    resolveType(v[1], typePrefix),
  ]);
  return {
    name,
    unmodifiedName,
    ...(name == right ? {} : { right }),
    parameters,
  };
}

function findNullableParameters(line: string) {
  const parameters = line
    .split(/(@)/g)
    .slice(1)
    .filter((v) => v != "@")
    .map((v) => [v.split(" ", 1)[0], v])
    .map((v) => [v[0], v[1].slice(v[0].length + 1).trim()]);
  return parameters
    .filter((v) => v[1].includes("may be null") || v[1].includes("pass null"))
    .map((v) => v[0]);
}

for (const part of parts) {
  const nullable = new Array<string>();
  for (const line of part) {
    if (line.startsWith("//@class")) {
      const parts = line.split(" ", 3);
      const name = parts[1];
      const description = line.slice(parts.join(" ").length + 1);
      classes += `/**
 * ${description}
 */
export class ${name} extends Class {
}

`;
    } else if (line.startsWith("//@") && !line.startsWith("//@description")) {
      nullable.push(...findNullableParameters(line));
    }
  }
  const line = part[part.length - 1];
  if (line && lines.indexOf(line) < lines.indexOf("---functions---")) {
    const entry = getEntry(part[part.length - 1]);
    classes += `export class ${entry.name} extends ${entry.right ?? "Class"} {
  "@type" = "${entry.unmodifiedName}"${
      entry.parameters.length != 0
        ? "\n  " +
          entry.parameters
            .map((v) => [v[0] + (nullable.includes(v[0]) ? "?" : ""), v[1]])
            .map((v) => v.join(": "))
            .join(";\n  ") +
          ";"
        : ""
    }

  constructor(params: {${
      entry.parameters.length != 0
        ? " " + entry.parameters
          .map((v) => [v[0] + (nullable.includes(v[0]) ? "?" : ""), v[1]]).map((
            v,
          ) => v.join(": ")).join(", ") +
          " "
        : ""
    }}) {
    super();${
      entry.parameters.length != 0
        ? "\n    " + entry.parameters
          .map((v) => v[0])
          .map((v) => `this.${v} = params.${v};`)
          .join("\n    ")
        : ""
    }
  }
}

`;
  }
}

classes = classes.trim() + "\n\n// This was generated. Do not edit.\n";

await Deno.writeTextFile("classes.ts", classes);

let client = `// This was generated. Do not edit.
// deno-lint-ignore-file
// deno-fmt-ignore-file

import { BaseClient } from "./base_client.ts";
import * as classes from "./classes.ts";

export class Client extends BaseClient {
`;

for (const part of parts) {
  const nullable = new Array<string>();
  for (const line of part) {
    if (line.startsWith("//@") && !line.startsWith("//@description")) {
      nullable.push(...findNullableParameters(line));
    }
  }
  const line = part[part.length - 1];
  if (line && lines.indexOf(line) > lines.indexOf("---functions---")) {
    const entry = getEntry(part[part.length - 1], "classes.");
    client += `  ${entry.unmodifiedName}(${
      entry.parameters.length != 0
        ? "params: { " +
          entry.parameters
            .map((v) => [v[0] + (nullable.includes(v[0]) ? "?" : ""), v[1]])
            .map((v) => v.join(": "))
            .join(", ") +
          " }"
        : ""
    }): Promise<classes.${entry.right}> {
    return this.send({ "@type": "${entry.unmodifiedName}"${
      entry.parameters.length != 0 ? " , ...params" : ""
    } });
  }

`;
  }
}

client = client.trim();
client += "\n}\n\n// This was generated. Do not edit.\n";

await Deno.writeTextFile("client.ts", client);
