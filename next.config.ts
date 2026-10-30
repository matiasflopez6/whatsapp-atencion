import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // `pg` usa módulos nativos opcionales; mantenerlo fuera del bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
