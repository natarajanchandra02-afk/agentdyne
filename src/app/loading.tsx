import Image from "next/image"

export default function Loading() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl bg-zinc-900 mx-auto mb-5 flex items-center justify-center shadow-sm animate-pulse">
          <svg width="24" height="24" viewBox="0 0 80 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 8L8 40Q8 44 12 44L24 44Q36 44 36 24Q36 8 24 8Z M16 16L23 16Q28 16 28 24Q28 36 23 36L16 36Z" fill="white" />
            <path d="M72 8L72 40Q72 44 68 44L56 44Q44 44 44 24Q44 8 56 8Z M64 16L57 16Q52 16 52 24Q52 36 57 36L64 36Z" fill="white" />
          </svg>
        </div>
        <div className="flex items-center justify-center gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
