import Link from "next/link";

export const metadata = {
  title: "Coffee — luckyzz.kr",
  description: "원두, 레시피, 카페 기록",
};

export default function CoffeePage() {
  return (
    <div
      className="min-h-[calc(100vh-5rem)]"
      style={{ background: "#0B0B0B", color: "#E9E7E2" }}
    >
      <div className="max-w-4xl mx-auto px-6 py-24">
        <h1 className="text-4xl mb-6 tracking-tight">Coffee</h1>
        <p className="opacity-70 mb-12">원두·레시피·카페 아카이브.</p>
        <ul className="space-y-3 text-sm">
          <li>
            <Link href="/coffee/beans" className="opacity-80 hover:opacity-100">
              Beans →
            </Link>
          </li>
          <li>
            <Link href="/coffee/recipes" className="opacity-80 hover:opacity-100">
              Recipes →
            </Link>
          </li>
          <li>
            <Link href="/coffee/cafes" className="opacity-80 hover:opacity-100">
              Cafes →
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
}
