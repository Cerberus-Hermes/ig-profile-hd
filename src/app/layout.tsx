import "./globals.css";

export const metadata = {
  title: "IG Profile HD — Download Instagram Profile Pictures",
  description: "Download Instagram profile pictures in full resolution. Simple, fast, free.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
