import type { Viewer } from "@/lib/types";

type ViewerAccessExpectation = Pick<
  Viewer,
  "roles" | "globalAccessLevel" | "isMember" | "canReview" | "isTeacherAdmin" | "isPlatformOwner"
>;

interface SyntheticAccount extends ViewerAccessExpectation {
  email: string;
  fullName: string;
}

export const syntheticAccounts = {
  platformOwner: {
    email: "admin@example.edu",
    fullName: "Ada Administrator",
    roles: [],
    globalAccessLevel: "platform_owner",
    isMember: false,
    canReview: true,
    isTeacherAdmin: true,
    isPlatformOwner: true,
  },
  committeeHead: {
    email: "reviewer@example.edu",
    fullName: "Riley Reviewer",
    roles: ["member", "committee_head"],
    globalAccessLevel: null,
    isMember: true,
    canReview: true,
    isTeacherAdmin: false,
    isPlatformOwner: false,
  },
  member: {
    email: "member@example.edu",
    fullName: "Morgan Member",
    roles: ["member"],
    globalAccessLevel: null,
    isMember: true,
    canReview: false,
    isTeacherAdmin: false,
    isPlatformOwner: false,
  },
  presidentVicePresident: {
    email: "vice-president@example.edu",
    fullName: "Val Vice President",
    roles: ["member", "president_vice_president"],
    globalAccessLevel: null,
    isMember: true,
    canReview: true,
    isTeacherAdmin: false,
    isPlatformOwner: false,
  },
  leaderMember: {
    email: "leader@example.edu",
    fullName: "Lee Leader",
    roles: ["member", "president_vice_president"],
    globalAccessLevel: null,
    isMember: true,
    canReview: true,
    isTeacherAdmin: false,
    isPlatformOwner: false,
  },
  expiredMember: {
    email: "expired-member@example.edu",
    fullName: "Emery Expired Member",
    roles: [],
    globalAccessLevel: null,
    isMember: false,
    canReview: false,
    isTeacherAdmin: false,
    isPlatformOwner: false,
  },
} satisfies Record<string, SyntheticAccount>;
