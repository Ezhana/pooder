import { ContributionPoint } from "../index";

interface ToolContributionPoint extends ContributionPoint {
  name: string;
  handler: () => void;
}
