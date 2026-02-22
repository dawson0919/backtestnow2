import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#0a0d0f] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white">BacktestNow</h1>
          <p className="text-slate-400 text-sm mt-2">AI 策略回測優化平台</p>
        </div>
        <SignIn />
      </div>
    </div>
  )
}
