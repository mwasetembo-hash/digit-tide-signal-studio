<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Market data uses Deriv's public feed wss://api.derivws.com/trading/v1/options/ws/public; trading with a pat_ token uses REST accounts + OTP WebSocket (legacy ws.derivws.com v3 does not respond). Signal agents live in src/lib/scanner.ts as pure functions so they can be unit-tested.
