import { Bot } from "lucide-react"

export default function Loading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-brand mx-auto mb-4 flex items-center justify-center animate-pulse shadow-primary">
          <Bot className="h-6 w-6 text-white" />
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      </div>
    </div>
  )
}
