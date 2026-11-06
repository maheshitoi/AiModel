import { BadGatewayException, BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { AiServiceError } from './ai-client.service';

/** AI service failures become 503/502/4xx with the client's fixed messages, never upstream bodies. */
export async function callAi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof AiServiceError)) throw error;
    switch (error.kind) {
      case 'rejected':
        throw new BadRequestException(error.message);
      case 'not_found':
        throw new NotFoundException(error.message);
      case 'conflict':
        throw new ConflictException(error.message);
      case 'misconfigured':
      case 'bad_response':
        throw new BadGatewayException(error.message);
      default:
        throw new ServiceUnavailableException(error.message);
    }
  }
}
