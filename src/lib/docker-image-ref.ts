export type ParsedDockerImageRef =
  | {
      ok: true;
      image: string;
      nameHint: string;
      registryHost: string | null;
    }
  | { ok: false; error: string };

const METACHAR = /[\s$`;|&<>()]/;

/**
 * Parse a Docker-style image reference for Forge From-image create.
 * Does not pull or resolve Hub library/ prefixes.
 */
export function parseDockerImageRef(input: string): ParsedDockerImageRef {
  const image = input.trim();
  if (!image) {
    return { ok: false, error: "Image reference is required" };
  }
  if (METACHAR.test(image) || image.includes("\n") || image.includes("\r")) {
    return {
      ok: false,
      error: "Image reference must not contain whitespace or shell metacharacters",
    };
  }
  if (image.startsWith("-") || image.includes("://")) {
    return { ok: false, error: "Invalid image reference" };
  }

  const digestAt = image.lastIndexOf("@");
  const namePart = digestAt >= 0 ? image.slice(0, digestAt) : image;
  const colon = namePart.lastIndexOf(":");
  const slash = namePart.lastIndexOf("/");
  const untagged =
    colon > slash && colon >= 0 ? namePart.slice(0, colon) : namePart;
  const repoLeaf = untagged.split("/").filter(Boolean).pop() ?? untagged;
  const nameHint = repoLeaf.replace(/[^A-Za-z0-9._-]+/g, "-") || "image";

  const firstSlash = untagged.indexOf("/");
  let registryHost: string | null = null;
  if (firstSlash > 0) {
    const maybeHost = untagged.slice(0, firstSlash);
    if (maybeHost.includes(".") || maybeHost.includes(":") || maybeHost === "localhost") {
      registryHost = maybeHost;
    }
  }

  return { ok: true, image, nameHint, registryHost };
}
