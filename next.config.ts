import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Настройки по умолчанию от create-next-app. @huggingface/transformers и onnxruntime-node
  // Next.js сам не собирает в бандл (встроенный список serverExternalPackages).
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
