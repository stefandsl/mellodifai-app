"use client";
import {
  ACTIVE_PLATFORMS,
  PLATFORM_LABELS,
  type Platform,
} from "@mellodifai/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  decidePublication,
  deletePublishRule,
  savePublishRule,
} from "@/app/actions/publishing";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/components/use-action";
import type { ScheduleView } from "@/lib/ops/defs/publishing";
import { pt } from "./copy";
import { romeTime } from "./publish-dashboard";

type Rule = {
  rule_id: string;
  platform: Platform;
  max_price_eur: number;
  require_veto_hours: number;
  active: boolean;
};

// Settings > Pubblicazione: the owner's standing rules and every approval card still waiting.
export function PublishSettings({
  rules,
  approvals,
}: {
  rules: Rule[];
  approvals: ScheduleView[];
}) {
  const lang = useLocale();
  const router = useRouter();
  const { pending, run } = useAction();
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [hours, setHours] = useState("24");
  const [price, setPrice] = useState("0");
  const refresh = () => router.refresh();
  return (
    <div className="grid gap-6">
      <Card role="region" aria-label={pt(lang, "pending")}>
        <CardHeader>
          <CardTitle>{pt(lang, "pending")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {approvals.length === 0 ? (
            <p className="text-muted-foreground">{pt(lang, "noPending")}</p>
          ) : (
            approvals.map((plan) =>
              plan.approval ? (
                <div
                  key={plan.schedule_id}
                  className="grid gap-2 rounded-lg border border-border p-3"
                >
                  <p>{plan.approval.summary}</p>
                  <p className="text-sm text-muted-foreground">
                    {pt(lang, "price", {
                      price: plan.approval.price_eur.toFixed(2),
                    })}
                    {" · "}
                    {pt(lang, "requestedVia", {
                      via: pt(lang, `via.${plan.approval.requested_via}`),
                    })}
                    {" · "}
                    {romeTime(plan.approval.expires_at, lang)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            decidePublication({
                              approvalId: plan.approval?.approval_id,
                              decision: "approve",
                            }),
                          refresh,
                        )
                      }
                    >
                      {pt(lang, "approve")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () =>
                            decidePublication({
                              approvalId: plan.approval?.approval_id,
                              decision: "reject",
                            }),
                          refresh,
                        )
                      }
                    >
                      {pt(lang, "reject")}
                    </Button>
                    <Link
                      className="text-sm underline-offset-4 hover:underline"
                      href={`/projects/${plan.project_id}/publish?lang=${plan.lang}`}
                    >
                      {pt(lang, "openPlan")}
                    </Link>
                  </div>
                </div>
              ) : null,
            )
          )}
        </CardContent>
      </Card>

      <Card role="region" aria-label={pt(lang, "rules")}>
        <CardHeader>
          <CardTitle>{pt(lang, "rules")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {pt(lang, "rulesHint")}
          </p>
          {rules.length === 0 ? (
            <p>{pt(lang, "noRules")}</p>
          ) : (
            <ul className="grid gap-2">
              {rules.map((rule) => (
                <li
                  key={rule.rule_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
                >
                  <span className="font-medium">
                    {PLATFORM_LABELS[rule.platform]}
                  </span>
                  <span className="text-sm">
                    {pt(lang, "ruleVeto")}: {rule.require_veto_hours}
                  </span>
                  <span className="text-sm">
                    {pt(lang, "ruleMaxPrice")}: {rule.max_price_eur.toFixed(2)}
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={rule.active}
                      disabled={pending}
                      onChange={(event) =>
                        run(
                          () =>
                            savePublishRule({
                              rule_id: rule.rule_id,
                              platform: rule.platform,
                              max_price_eur: rule.max_price_eur,
                              require_veto_hours: rule.require_veto_hours,
                              active: event.target.checked,
                            }),
                          refresh,
                        )
                      }
                    />
                    {pt(lang, "ruleActive")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deletePublishRule({ ruleId: rule.rule_id }),
                        refresh,
                      )
                    }
                  >
                    {pt(lang, "ruleDelete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () =>
                  savePublishRule({
                    platform,
                    max_price_eur: Number(price),
                    require_veto_hours: Number(hours),
                    active: true,
                  }),
                refresh,
              );
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="rule-platform">{pt(lang, "rulePlatform")}</Label>
              <select
                id="rule-platform"
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
                value={platform}
                onChange={(event) =>
                  setPlatform(event.target.value as Platform)
                }
              >
                {ACTIVE_PLATFORMS.map((item) => (
                  <option key={item} value={item}>
                    {PLATFORM_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-veto">{pt(lang, "ruleVeto")}</Label>
              <Input
                id="rule-veto"
                type="number"
                min={1}
                max={168}
                step={1}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                className="w-28"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-price">{pt(lang, "ruleMaxPrice")}</Label>
              <Input
                id="rule-price"
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className="w-28"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pt(lang, "ruleAdd")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
