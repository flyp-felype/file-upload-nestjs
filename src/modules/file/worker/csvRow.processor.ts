import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
} from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import { createRedisConnection } from 'src/config/redis.config';
import { FileDto } from '../dto/file-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileRow, FileRowStatus } from '../entities/fileRow.entity';
import { FileMetadata } from '../entities/fileMetadata.entity';

@Injectable()
export class CsvProcessorRowService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CsvProcessorRowService.name);
  private worker: Worker;
  constructor(
    @InjectRepository(FileRow)
    private fileRowRepository: Repository<FileRow>,
    @Inject('CSV_QUEUE') private readonly queue: Queue,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      'process-csv-row',
      async (job: Job<{ row: FileDto; fileMetadata: FileMetadata }>) => {
        this.logger.log('Processando linha:', job.data.row);

        const { row, fileMetadata } = job.data;

        const fileRow = this.fileRowRepository.create({
          row: JSON.stringify(row),
          fileMetadata: fileMetadata,
          status: FileRowStatus.PENDING,
        });

        const fileRowSave = await this.fileRowRepository.save(fileRow);

        this.queue
          .add('debits-processing', { fileRow: fileRowSave })
          .catch((error) => this.logger.error(error));
      },
      { connection: createRedisConnection() },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} processado com sucesso.`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} falhou:`, err);
    });
  }

  onModuleDestroy() {
    this.worker.close();
  }
}
