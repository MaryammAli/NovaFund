import { AprService } from "../apr.service";
import { AprRepository } from "../apr.repository";

describe("AprService", () => {
  it("calculates APR correctly", async () => {
    const repo = new AprRepository();
    const service = new AprService(repo);

    const result = await service.calculateAPR();

    expect(result).toHaveProperty("apr");
    expect(result.apr).toBeGreaterThanOrEqual(0);
  });
});