import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // An import sends only the rows a person confirmed -- never the file --
      // but up to 5,000 of them, and a file may be up to 5 MB
      // (lib/importCsv.ts). The 1 MB default would refuse a big one; JSON
      // keys add overhead to the cells, so leave room.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
