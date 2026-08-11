import Link from 'next/link';

const PLANS = [
  {
    name: 'Starter',
    price: 'KES 2,500',
    period: '/month',
    description: 'Perfect for small schools just getting started.',
    features: [
      'Up to 200 students',
      'Attendance + timetable',
      'Parent & teacher apps',
      'In-app messaging',
      'Email notifications',
      'Document library',
    ],
    cta: 'Start free trial',
    href: '/signup',
    highlight: false,
  },
  {
    name: 'School',
    price: 'KES 6,000',
    period: '/month',
    description: 'The complete platform for growing schools.',
    features: [
      'Unlimited students',
      'Everything in Starter',
      'Online fee collection (M-Pesa + card)',
      'Gradebook + report cards',
      'Quizzes + assignments',
      'Analytics dashboards',
      'Behaviour tracking',
      'API access + webhooks',
      'Priority support',
    ],
    cta: 'Start free trial',
    href: '/signup',
    highlight: true,
  },
  {
    name: 'Network',
    price: 'Custom',
    period: '',
    description: 'For school groups and county education boards.',
    features: [
      'Multiple schools under one account',
      'Centralised analytics',
      'Dedicated onboarding',
      'SLA + uptime guarantee',
      'Custom integrations',
      'White-label option',
    ],
    cta: 'Contact us',
    href: 'mailto:hello@schoolmanager.app',
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <span className="font-bold text-slate-800 text-lg">School Manager</span>
        <div className="flex gap-4">
          <Link href="/login" className="text-sm text-slate-600 hover:text-slate-900">Sign in</Link>
          <Link href="/signup" className="text-sm bg-slate-900 text-white px-4 py-1.5 rounded-lg hover:bg-slate-700">Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="text-center py-16 px-4">
        <h1 className="text-4xl font-bold text-slate-900">Simple, transparent pricing</h1>
        <p className="text-slate-500 mt-4 text-lg max-w-xl mx-auto">
          Start free. No credit card required. Cancel anytime.
        </p>
      </div>

      {/* Plans */}
      <div className="max-w-5xl mx-auto px-4 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`bg-white rounded-2xl border p-6 flex flex-col ${
              plan.highlight
                ? 'border-slate-900 shadow-xl ring-2 ring-slate-900'
                : 'border-slate-200 shadow-sm'
            }`}
          >
            {plan.highlight && (
              <div className="text-xs font-bold text-white bg-slate-900 px-3 py-1 rounded-full self-start mb-3">
                Most popular
              </div>
            )}
            <h2 className="text-xl font-bold text-slate-800">{plan.name}</h2>
            <div className="mt-2 mb-1">
              <span className="text-3xl font-bold text-slate-900">{plan.price}</span>
              <span className="text-slate-400 text-sm">{plan.period}</span>
            </div>
            <p className="text-sm text-slate-500 mb-4">{plan.description}</p>

            <ul className="space-y-2 flex-1 mb-6">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <Link
              href={plan.href}
              className={`block text-center py-2.5 rounded-xl font-semibold text-sm transition-colors ${
                plan.highlight
                  ? 'bg-slate-900 text-white hover:bg-slate-700'
                  : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>

      {/* FAQ strip */}
      <div className="bg-white border-t border-slate-200 py-12 px-4">
        <div className="max-w-2xl mx-auto space-y-6">
          <h2 className="text-2xl font-bold text-slate-800 text-center">Common questions</h2>
          {[
            ['Is there a free trial?', 'Yes — all plans include a 30-day free trial. No credit card needed to start.'],
            ['How does the student count work?', 'A "student" is any active enrolled account. Archived students do not count.'],
            ['Can I pay with M-Pesa?', 'Yes. We accept M-Pesa, Visa, and Mastercard via Paystack.'],
            ['What happens if I exceed my plan?', 'We will notify you and give you 30 days to upgrade. No sudden lockout.'],
          ].map(([q, a]) => (
            <div key={q} className="border-b border-slate-100 pb-4">
              <p className="font-semibold text-slate-800">{q}</p>
              <p className="text-sm text-slate-500 mt-1">{a}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="text-center py-8 text-sm text-slate-400">
        © {new Date().getFullYear()} School Manager · Built for Kenyan schools
        {/*
          TODO(owner): once the Better Stack (or equivalent) public status
          page is live, add its real URL here, e.g.:
          {' · '}<a href="https://status.example.com" className="underline hover:text-slate-600">Status</a>
          See README.md's "Documentation" section for setup notes — do not
          fabricate a URL in the meantime.
        */}
      </footer>
    </div>
  );
}
