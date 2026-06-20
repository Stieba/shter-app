export const metadata = {
  title: "SHTER — bandplanning",
  description: "Gedeelde kalender voor SHTER",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
