/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_CONTRACT_ADDRESS: "0x4f079033484B806e42385E53bE20209B89049Bee"
  }
};
module.exports = nextConfig;
