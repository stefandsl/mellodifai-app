import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { SiteCopy } from "@/lib/site/copy";
import { DESKTOP_PLATFORM_LIST } from "@/lib/site/downloads";
import { SiteHeading, SiteLink, SiteText } from "@/src/site-primitives";
import {
  SiteTable,
  SiteTableBody,
  SiteTableCell,
  SiteTableHeader,
  SiteTableHeaderCell,
  SiteTableRow,
} from "@/src/site-table-primitives";

export type PlatformTableProps = {
  copy: SiteCopy["desktop"]["platforms"];
  id?: string;
};

// Honest platform status table (decision D7): Windows, macOS, Linux are always rendered and
// reachable. A platform without a real package shows "planned" with no download link and offers
// the browser studio. Never invents a binary URL.
export function PlatformTable({ copy, id = "platforms" }: PlatformTableProps) {
  return (
    <VStack
      id={id}
      className="site-desk-platforms"
      gap={6}
      aria-labelledby="desktop-platforms-title"
    >
      <VStack gap={2}>
        <SiteHeading
          level={3}
          id="desktop-platforms-title"
          className="site-desk-platforms__title"
        >
          {copy.title}
        </SiteHeading>
        <SiteText as="p" color="secondary" className="site-lede">
          {copy.line}
        </SiteText>
      </VStack>
      <SiteTable
        aria-labelledby="desktop-platforms-title"
        className="site-desk-table"
      >
        <SiteTableHeader>
          <SiteTableRow>
            <SiteTableHeaderCell scope="col">
              {copy.colPlatform}
            </SiteTableHeaderCell>
            <SiteTableHeaderCell scope="col">
              {copy.colStatus}
            </SiteTableHeaderCell>
            <SiteTableHeaderCell scope="col">
              {copy.colPackage}
            </SiteTableHeaderCell>
            <SiteTableHeaderCell scope="col">
              {copy.colAction}
            </SiteTableHeaderCell>
          </SiteTableRow>
        </SiteTableHeader>
        <SiteTableBody>
          {DESKTOP_PLATFORM_LIST.map((platform) => {
            const statusText = copy.statusLabels[platform.status];
            return (
              <SiteTableRow
                key={platform.id}
                className="site-desk-table__row"
                data-platform-row={platform.id}
                data-platform-status={platform.status}
                data-current-platform="false"
              >
                <SiteTableHeaderCell
                  scope="row"
                  className="site-desk-table__os"
                >
                  <VStack gap={1}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <SiteText weight="medium">
                        {copy.names[platform.id]}
                      </SiteText>
                      <SiteText
                        type="code"
                        className="site-tag site-tag--accent site-desk-table__current"
                        data-platform-current-badge={platform.id}
                        hidden
                      >
                        {copy.currentBadge}
                      </SiteText>
                    </HStack>
                    <SiteText type="supporting" color="secondary">
                      {platform.requirement}
                    </SiteText>
                  </VStack>
                </SiteTableHeaderCell>
                <SiteTableCell>
                  <SiteText
                    type="code"
                    className={
                      platform.status === "planned"
                        ? "site-tag"
                        : "site-tag site-tag--accent"
                    }
                  >
                    {statusText}
                  </SiteText>
                </SiteTableCell>
                <SiteTableCell>
                  <VStack gap={1}>
                    <SiteText type="supporting">
                      {copy.details[platform.id]}
                    </SiteText>
                    {platform.buildCommand ? (
                      <SiteText
                        type="code"
                        color="secondary"
                        className="site-desk-table__cmd"
                      >
                        {platform.buildCommand}
                      </SiteText>
                    ) : null}
                  </VStack>
                </SiteTableCell>
                <SiteTableCell>
                  {platform.downloadUrl ? (
                    <VStack gap={1}>
                      <SiteLink
                        href={platform.downloadUrl}
                        rel={
                          platform.external ? "noopener noreferrer" : undefined
                        }
                        className="site-link"
                        data-platform-link={platform.id}
                      >
                        {copy.windowsAction}
                      </SiteLink>
                      <SiteLink
                        href={platform.browserHref}
                        color="secondary"
                        type="supporting"
                      >
                        {copy.browserAction}
                      </SiteLink>
                    </VStack>
                  ) : (
                    <VStack gap={1}>
                      <SiteText
                        type="supporting"
                        color="secondary"
                        data-platform-planned={platform.id}
                      >
                        {copy.plannedNote}
                      </SiteText>
                      <SiteLink
                        href={platform.browserHref}
                        className="site-link"
                        data-platform-browser-link={platform.id}
                      >
                        {copy.browserAction}
                      </SiteLink>
                    </VStack>
                  )}
                </SiteTableCell>
              </SiteTableRow>
            );
          })}
        </SiteTableBody>
      </SiteTable>
    </VStack>
  );
}
