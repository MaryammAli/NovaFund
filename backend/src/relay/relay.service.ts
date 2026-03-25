import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransactionBuilder,
  Keypair,
  Networks,
  Horizon,
  Transaction,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';

@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);
  private readonly sponsorKeypair: Keypair;
  private readonly server: Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(private readonly config: ConfigService) {
    const stellarConfig = this.config.get('stellar');
    if (!stellarConfig.sponsorSecretKey) {
      this.logger.error('STELLAR_SPONSOR_SECRET_KEY is not configured');
    } else {
      this.sponsorKeypair = Keypair.fromSecret(stellarConfig.sponsorSecretKey);
    }
    
    // We use Horizon for submitting fee bump transactions
    // If it's a Soroban transaction, it can still be wrapped in a Fee Bump and submitted via Horizon or RPC
    // Horizon is generally safer for Fee Bump submission as it's a standard Stellar feature
    this.server = new Horizon.Server(process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org');
    this.networkPassphrase = stellarConfig.networkPassphrase || Networks.TESTNET;
  }

  async relayTransaction(xdr: string): Promise<{ hash: string; ledger: number }> {
    if (!this.sponsorKeypair) {
      throw new InternalServerErrorException('Sponsor key is not configured');
    }

    try {
      // 1. Decode the inner transaction
      const innerTx = TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
      
      if (!(innerTx instanceof Transaction)) {
        throw new BadRequestException('Invalid inner transaction type');
      }

      // 2. Build the Fee Bump transaction
      // The fee must be at least (inner_ops + 1) * base_fee
      // We'll use a safe margin or let the SDK calculate it if possible
      // Actually, we should probably fetch the latest base fee
      const feeStats = await this.server.fetchBaseFee();
      const baseFee = parseInt(feeStats.toString(), 10) || 100;
      
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        this.sponsorKeypair,
        (baseFee * (innerTx.operations.length + 1)).toString(),
        innerTx,
        this.networkPassphrase,
      );

      // 3. Sign the Fee Bump transaction
      feeBumpTx.sign(this.sponsorKeypair);

      // 4. Submit to the network
      this.logger.log(`Submitting fee-bumped transaction for ${innerTx.source}`);
      const response = await this.server.submitTransaction(feeBumpTx);

      return {
        hash: response.hash,
        ledger: response.ledger,
      };
    } catch (error) {
      this.logger.error(`Relay failed: ${error.message}`, error.stack);
      if (error.response?.data?.extras?.result_codes) {
        this.logger.error(`Result codes: ${JSON.stringify(error.response.data.extras.result_codes)}`);
      }
      throw new BadRequestException(`Failed to relay transaction: ${error.message}`);
    }
  }
}
