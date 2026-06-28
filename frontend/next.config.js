/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1A247D4F65a92Ec862b8dBCa05215e481b64bE89"
  }
};
module.exports = nextConfig;
