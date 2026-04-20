# Holstein Dispersal NPV Analysis

Interactive NPV analysis tool for dairy herd dispersal auctions.

## Features

- Risk-adjusted 5-year NPV projections for 73 auction lots
- Probability-weighted cash flows with 8+ layers of risk modeling
- Adjustable milk price, cull price, and calf price sliders
- Buyer profile toggle (strict vs permissive management)
- Herd-specific lactation curve (IOFC by stage and parity)
- Click any lot for detailed math breakdown

## Local Development

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Deployment

Hosted on Vercel. Pushes to the main branch auto-deploy to production.

## Assumptions

All modeling assumptions are documented in the footnote at the bottom of the application.
