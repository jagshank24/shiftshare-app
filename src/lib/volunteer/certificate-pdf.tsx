import React from "react";
import type { Style } from "@react-pdf/types";

export interface CertificateEventRow {
  eventId: string;
  eventName: string;
  dateFormatted: string;
  organizerName: string;
  roleName: string;
  hours: number;
}

export type CertificateEventItem = CertificateEventRow;

export interface CertificateData {
  volunteerName: string;
  events: CertificateEventRow[];
  totalVerifiedHours: number;
  dateIssued: string;
  verificationCode: string;
  verifyUrl: string;
  verifyQrDataUrl: string;
  singleEventTitle?: string | null;
}

type ReactPdfModule = typeof import("@react-pdf/renderer");

let reactPdfPromise: Promise<ReactPdfModule> | null = null;

/**
 * Loads `@react-pdf/renderer` through Node's native ESM `import()` so its
 * ESM-only transitive dependency (`@react-pdf/hyphenate/en-us`) always resolves
 * with the `"import"` condition in both Next.js and `tsx` test runners.
 */
function loadReactPdf(): Promise<ReactPdfModule> {
  if (!reactPdfPromise) {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<ReactPdfModule>;
    reactPdfPromise = dynamicImport("@react-pdf/renderer");
  }
  return reactPdfPromise;
}

const styles: Record<string, Style> = {
  page: {
    backgroundColor: "#FAF8F3",
    paddingTop: 28,
    paddingBottom: 28,
    paddingHorizontal: 32,
    fontFamily: "Helvetica",
    color: "#1B2A49",
  },
  outerBorder: {
    borderWidth: 2.5,
    borderColor: "#1B2A49",
    padding: 4,
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  innerBorder: {
    borderWidth: 1,
    borderColor: "#FFC93C",
    paddingVertical: 18,
    paddingHorizontal: 22,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1.5,
    borderBottomColor: "#E4DFD3",
    paddingBottom: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#1B2A49",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },
  logoText: {
    color: "#FFC93C",
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
  },
  brandName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 15,
    color: "#1B2A49",
    letterSpacing: -0.3,
  },
  brandSub: {
    fontSize: 8,
    color: "#52607A",
    marginTop: 1,
  },
  badgePill: {
    backgroundColor: "#E6F8F6",
    borderWidth: 1,
    borderColor: "#2EC4B6",
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: "#13796F",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  titleBlock: {
    marginTop: 12,
    marginBottom: 10,
    alignItems: "center",
  },
  kicker: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    color: "#52607A",
    textTransform: "uppercase",
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  serifHeading: {
    fontFamily: "Times-Bold",
    fontSize: 22,
    color: "#1B2A49",
    textAlign: "center",
  },
  presentedTo: {
    fontSize: 9.5,
    color: "#52607A",
    marginTop: 6,
  },
  volunteerName: {
    fontFamily: "Times-BoldItalic",
    fontSize: 20,
    color: "#1B2A49",
    marginTop: 2,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: "#FFC93C",
  },
  summarySentence: {
    fontSize: 9,
    color: "#3A4B6E",
    marginTop: 5,
    textAlign: "center",
  },
  tableContainer: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#D8D2C5",
    borderRadius: 4,
    overflow: "hidden",
    flexGrow: 1,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#1B2A49",
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  thEvent: {
    width: "30%",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#FAF8F3",
    textTransform: "uppercase",
  },
  thDate: {
    width: "20%",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#FAF8F3",
    textTransform: "uppercase",
  },
  thOrganizer: {
    width: "20%",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#FAF8F3",
    textTransform: "uppercase",
  },
  thRole: {
    width: "18%",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#FAF8F3",
    textTransform: "uppercase",
  },
  thHours: {
    width: "12%",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#FFC93C",
    textTransform: "uppercase",
    textAlign: "right",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4.2,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5DFD2",
  },
  tableRowAlt: {
    flexDirection: "row",
    paddingVertical: 4.2,
    paddingHorizontal: 8,
    backgroundColor: "#F3EFE6",
    borderBottomWidth: 0.5,
    borderBottomColor: "#E5DFD2",
  },
  tdEvent: {
    width: "30%",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1B2A49",
    paddingRight: 4,
  },
  tdDate: {
    width: "20%",
    fontSize: 7.8,
    color: "#3A4B6E",
    paddingRight: 4,
  },
  tdOrganizer: {
    width: "20%",
    fontSize: 7.8,
    color: "#3A4B6E",
    paddingRight: 4,
  },
  tdRole: {
    width: "18%",
    fontSize: 7.8,
    color: "#1B2A49",
    paddingRight: 4,
  },
  tdHours: {
    width: "12%",
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1B2A49",
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#EFE9DC",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: "#1B2A49",
  },
  totalLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#1B2A49",
    textTransform: "uppercase",
  },
  totalValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#13796F",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E4DFD3",
  },
  metaCol: {
    flexDirection: "column",
    maxWidth: "72%",
  },
  metaRow: {
    flexDirection: "row",
    marginBottom: 3,
  },
  metaLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#52607A",
    width: 95,
  },
  metaValue: {
    fontSize: 8,
    color: "#1B2A49",
    fontFamily: "Helvetica-Bold",
  },
  metaUrl: {
    fontSize: 7.5,
    color: "#13796F",
    marginTop: 2,
  },
  qrBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D8D2C5",
    borderRadius: 4,
    padding: 5,
  },
  qrImage: {
    width: 52,
    height: 52,
  },
  qrCaptionCol: {
    marginLeft: 6,
    maxWidth: 78,
  },
  qrCaptionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: "#1B2A49",
  },
  qrCaptionSub: {
    fontSize: 6.8,
    color: "#52607A",
    marginTop: 1,
  },
};

function createCertificateDocumentElement(
  ReactPdf: ReactPdfModule,
  data: CertificateData,
) {
  const { Document, Page, Text, View, Image } = ReactPdf;
  // Keep up to 15 events on a single page cleanly
  const visibleEvents = data.events.slice(0, 15);

  return (
    <Document
      title={`ShiftShare Verified Hours Certificate - ${data.volunteerName}`}
      author="ShiftShare"
      subject="Verified Volunteer Service Hours Certificate"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.outerBorder}>
          <View style={styles.innerBorder}>
            <View>
              {/* Header with ShiftShare Logo + Verified Badge */}
              <View style={styles.headerRow}>
                <View style={styles.brandRow}>
                  <View style={styles.logoBox}>
                    <Text style={styles.logoText}>S</Text>
                  </View>
                  <View>
                    <Text style={styles.brandName}>ShiftShare</Text>
                    <Text style={styles.brandSub}>
                      Community Volunteer Coordination & Hour Verification
                    </Text>
                  </View>
                </View>
                <View style={styles.badgePill}>
                  <Text style={styles.badgeText}>Verified by ShiftShare</Text>
                </View>
              </View>

              {/* Clean Serif Heading + Volunteer Name */}
              <View style={styles.titleBlock}>
                <Text style={styles.kicker}>Official Record of Service</Text>
                <Text style={styles.serifHeading}>
                  Certificate of Verified Volunteer Hours
                </Text>
                <Text style={styles.presentedTo}>
                  This certifies that the volunteer service record below belongs
                  to
                </Text>
                <Text style={styles.volunteerName}>{data.volunteerName}</Text>
                <Text style={styles.summarySentence}>
                  {data.singleEventTitle
                    ? `Verified service completed for ${data.singleEventTitle}.`
                    : `Verified across ${visibleEvents.length} ${
                        visibleEvents.length === 1
                          ? "community event"
                          : "community events"
                      } via timestamped ShiftShare check-in and check-out logs.`}
                </Text>
              </View>

              {/* Table of Events (up to 15 rows on 1 page) */}
              <View style={styles.tableContainer}>
                <View style={styles.tableHeader}>
                  <Text style={styles.thEvent}>Event Name</Text>
                  <Text style={styles.thDate}>Date</Text>
                  <Text style={styles.thOrganizer}>Organizer</Text>
                  <Text style={styles.thRole}>Role</Text>
                  <Text style={styles.thHours}>Hours</Text>
                </View>

                {visibleEvents.length === 0 ? (
                  <View style={styles.tableRow}>
                    <Text style={styles.tdEvent}>
                      No completed verified events recorded yet
                    </Text>
                    <Text style={styles.tdDate}>—</Text>
                    <Text style={styles.tdOrganizer}>—</Text>
                    <Text style={styles.tdRole}>—</Text>
                    <Text style={styles.tdHours}>0.00 hrs</Text>
                  </View>
                ) : (
                  visibleEvents.map((row, idx) => (
                    <View
                      key={`${row.eventId}-${idx}`}
                      style={
                        idx % 2 === 1 ? styles.tableRowAlt : styles.tableRow
                      }
                    >
                      <Text style={styles.tdEvent}>{row.eventName}</Text>
                      <Text style={styles.tdDate}>{row.dateFormatted}</Text>
                      <Text style={styles.tdOrganizer}>{row.organizerName}</Text>
                      <Text style={styles.tdRole}>{row.roleName}</Text>
                      <Text style={styles.tdHours}>
                        {row.hours.toFixed(2)} hrs
                      </Text>
                    </View>
                  ))
                )}

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total Verified Hours</Text>
                  <Text style={styles.totalValue}>
                    {data.totalVerifiedHours.toFixed(2)} hours
                  </Text>
                </View>
              </View>
            </View>

            {/* Footer with Date Issued, Unique Verification Code, and QR Code */}
            <View style={styles.footerRow}>
              <View style={styles.metaCol}>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Date Issued:</Text>
                  <Text style={styles.metaValue}>{data.dateIssued}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Verification Code:</Text>
                  <Text style={styles.metaValue}>{data.verificationCode}</Text>
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>Total Verified:</Text>
                  <Text style={styles.metaValue}>
                    {data.totalVerifiedHours.toFixed(2)} hours
                  </Text>
                </View>
                <Text style={styles.metaUrl}>
                  Public verification URL: {data.verifyUrl}
                </Text>
              </View>

              <View style={styles.qrBox}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={data.verifyQrDataUrl} style={styles.qrImage} />
                <View style={styles.qrCaptionCol}>
                  <Text style={styles.qrCaptionTitle}>Scan to Verify</Text>
                  <Text style={styles.qrCaptionSub}>
                    Instantly confirms authenticity at /verify/
                    {data.verificationCode}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Renders the 1-page volunteer certificate PDF into a Node.js `Buffer`.
 */
export async function renderCertificatePdfBuffer(
  data: CertificateData,
): Promise<Buffer> {
  const ReactPdf = await loadReactPdf();
  return ReactPdf.renderToBuffer(
    createCertificateDocumentElement(ReactPdf, data),
  );
}
