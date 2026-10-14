/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Seiten nie aus dem Zwischenspeicher des Browsers zeigen:
    // sonst erscheint beim Zurückkehren in den Editor ein alter Textstand.
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
