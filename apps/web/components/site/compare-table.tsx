import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import type { CompareCell } from "@/lib/site/plans";
import { SiteIcon, SiteText } from "@/src/site-primitives";
import {
  SiteTable,
  SiteTableBody,
  SiteTableCell,
  SiteTableHeader,
  SiteTableHeaderCell,
  SiteTableRow,
} from "@/src/site-table-primitives";
import { CheckGlyph, DashGlyph } from "./icons";

export type CompareTableProps = {
  labelledBy: string;
  featureColumn: string;
  /** Head row: one column per plan, the price under the name. */
  columns: readonly { name: string; price: string }[];
  groups: readonly {
    label: string;
    rows: readonly { label: string; cells: readonly CompareCell[] }[];
  }[];
  /** Words of a text cell, by key. */
  cellText: (key: Exclude<CompareCell, boolean>) => string;
  included: string;
  notIncluded: string;
};

// The plans in one real table: a head row with the plans, then one body per group, each opened
// by its group label. A tick or a dash says included or not, with the words for screen readers.
export function CompareTable({
  labelledBy,
  featureColumn,
  columns,
  groups,
  cellText,
  included,
  notIncluded,
}: CompareTableProps) {
  return (
    <SiteTable aria-labelledby={labelledBy} className="site-compare">
      <SiteTableHeader>
        <SiteTableRow>
          <SiteTableHeaderCell scope="col" className="site-compare__corner">
            <VisuallyHidden>{featureColumn}</VisuallyHidden>
          </SiteTableHeaderCell>
          {columns.map((c) => (
            <SiteTableHeaderCell
              key={c.name}
              scope="col"
              className="site-compare__plan"
            >
              <SiteText weight="medium" className="site-compare__plan-name">
                {c.name}
              </SiteText>
              <SiteText type="supporting" color="secondary">
                {c.price}
              </SiteText>
            </SiteTableHeaderCell>
          ))}
        </SiteTableRow>
      </SiteTableHeader>
      {groups.map((g) => (
        <SiteTableBody key={g.label}>
          <SiteTableRow className="site-compare__group-row">
            <SiteTableHeaderCell
              scope="rowgroup"
              className="site-compare__group"
            >
              {g.label}
            </SiteTableHeaderCell>
            {columns.map((c) => (
              <SiteTableCell
                key={c.name}
                aria-hidden="true"
                className="site-compare__group"
              />
            ))}
          </SiteTableRow>
          {g.rows.map((r) => (
            <SiteTableRow key={r.label}>
              <SiteTableHeaderCell
                scope="row"
                className="site-compare__feature"
              >
                {r.label}
              </SiteTableHeaderCell>
              {r.cells.map((cell, i) => (
                <SiteTableCell
                  // The cells of a row are fixed by plan position.
                  // biome-ignore lint/suspicious/noArrayIndexKey: one cell per plan column
                  key={i}
                  className="site-compare__cell"
                  data-cell={typeof cell === "boolean" ? String(cell) : "text"}
                >
                  {typeof cell === "boolean" ? (
                    <>
                      <SiteIcon
                        icon={cell ? CheckGlyph : DashGlyph}
                        size="sm"
                        color={cell ? "primary" : "secondary"}
                      />
                      <VisuallyHidden>
                        {cell ? included : notIncluded}
                      </VisuallyHidden>
                    </>
                  ) : (
                    <SiteText type="supporting">{cellText(cell)}</SiteText>
                  )}
                </SiteTableCell>
              ))}
            </SiteTableRow>
          ))}
        </SiteTableBody>
      ))}
    </SiteTable>
  );
}
