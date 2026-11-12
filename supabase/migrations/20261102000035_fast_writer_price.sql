-- Verified 2026-11-03 against the public OpenRouter model page. No paid call.
insert into public.price_book (provider,model,unit,usd_per_unit,checked_on,source,verified) values
  ('openrouter','anthropic/claude-sonnet-5.5','mtok_in',2,'2026-11-03','https://openrouter.ai/anthropic/claude-sonnet-5.5',true),
  ('openrouter','anthropic/claude-sonnet-5.5','mtok_out',10,'2026-11-03','https://openrouter.ai/anthropic/claude-sonnet-5.5',true)
on conflict do nothing;
