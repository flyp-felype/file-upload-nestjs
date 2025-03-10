import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { Debts } from '../entities/debts.entity';
import { BoletoProvider } from '../../../infra/provider/boletos/bancoBrasil/boleto.provider';
import * as moment from 'moment';
import { InvoiceService } from './invoice.service';
import { KafkaProducer } from '../../../infra/kafka/kafka.producer';

describe('InvoiceService', () => {
  let service: InvoiceService;
  let debtsRepository: Repository<Debts>;
  let boletoProvider: BoletoProvider;
  let kafkaProducer: KafkaProducer;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceService,
        {
          provide: 'DebtsRepository',
          useValue: {
            findOne: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: BoletoProvider,
          useValue: {
            generateBoleto: jest.fn(),
          },
        },
        {
          provide: KafkaProducer,
          useValue: {
            sendMessage: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<InvoiceService>(InvoiceService);
    debtsRepository = module.get<Repository<Debts>>('DebtsRepository');
    boletoProvider = module.get<BoletoProvider>(BoletoProvider);
    kafkaProducer = module.get<KafkaProducer>(KafkaProducer);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handle', () => {
    it('should process a debt and generate a boleto', async () => {
      const mockDebt = {
        id: 1,
        debtId: '123',
        debtAmount: 100,
        name: 'John Doe',
        governmentId: '123456789',
        debtDueDate: '2023-12-31',
        invoiceGenerated: false,
      } as unknown as Debts;

      const mockBoleto = {
        barcode: '123456789',
        digitableLine: '123456789',
        dueDate: new Date('2023-12-31'),
        amount: 100,
      };

      jest.spyOn(debtsRepository, 'findOne').mockResolvedValue(mockDebt);

      jest
        .spyOn(boletoProvider, 'generateBoleto')
        .mockResolvedValue(mockBoleto);

      await service.handle('123');

      expect(boletoProvider.generateBoleto).toHaveBeenCalledWith({
        amount: mockDebt.debtAmount,
        payerName: mockDebt.name,
        payerDocument: mockDebt.governmentId,
        dueDate: moment(mockDebt.debtDueDate).toDate(),
      });

      expect(debtsRepository.update).toHaveBeenCalledWith(
        { id: mockDebt.id },
        { invoiceGenerated: true, barcode: mockBoleto.barcode },
      );

      expect(kafkaProducer.sendMessage).toHaveBeenCalled();
    });

    it('should throw an error if debt is not found', async () => {
      // Mock do findOne para retornar null
      jest.spyOn(debtsRepository, 'findOne').mockResolvedValue(null);

      await expect(service.handle('123')).rejects.toThrow(
        'Debt not found: 123',
      );
    });

    it('should throw an error if invoice is already generated', async () => {
      const mockDebt = {
        id: 1,
        debtId: '123',
        debtAmount: 100,
        name: 'John Doe',
        governmentId: '123456789',
        debtDueDate: '2023-12-31',
        invoiceGenerated: true, // Invoice já gerada
      } as unknown as Debts;

      // Mock do findOne
      jest.spyOn(debtsRepository, 'findOne').mockResolvedValue(mockDebt);

      await expect(service.handle('123')).rejects.toThrow(
        'Invoice already generated: 123',
      );
    });
  });
});
