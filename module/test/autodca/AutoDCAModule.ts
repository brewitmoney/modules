import { expect } from 'chai'
import { deployments, ethers, network } from 'hardhat'
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers"
import { getTestSafe, getEntryPoint, getTestToken, getSafe7579, getAutoDCAExecutor, getSessionValidator, getTestVault } from '../utils/setup'
import { logGas } from '../../src/utils/execution'
import {
  buildUnsignedUserOpTransaction,
} from '../../src/utils/userOp'
import execSafeTransaction from '../utils/execSafeTransaction';
import { parseEther, ZeroAddress } from 'ethers';
import { encodeAbiParameters, encodePacked, Hex, pad } from 'viem'



describe('Spendlimit session key - Basic tests', () => {

  
  const setupTests = deployments.createFixture(async ({ deployments }) => {
    await deployments.fixture()

    const [ user1, user2, relayer] = await ethers.getSigners()

    await impersonateAccount("0x958543756A4c7AC6fB361f0efBfeCD98E4D297Db");

    const mockAccount = await ethers.getImpersonatedSigner("0x958543756A4c7AC6fB361f0efBfeCD98E4D297Db");
    await setBalance(await mockAccount.getAddress(), parseEther('1'))
    


    let entryPoint = await getEntryPoint()

    entryPoint = entryPoint.connect(relayer)
    const autoDCAExecutor = await getAutoDCAExecutor()
       
    const sessionValidator =  await getSessionValidator()
    const safe7579 = await getSafe7579()

    let testTokens: (string | undefined)[] = []
    let testVaultAddress = ZeroAddress //WMATCI Vault

    if (network.tags.base) {
      // USDC and cbBTC
      testTokens = ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf"]
      testVaultAddress = ZeroAddress //WMATCI Vault

    }
    else if  (network.tags.polygon) {
      // USDC and WMATIC
      testTokens = ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"]
      testVaultAddress = "0x28F53bA70E5c8ce8D03b1FaD41E9dF11Bb646c36" //WMATIC Vault

    }
    const testToken = await getTestToken(testTokens[0])
    const testToken2 = await getTestToken(testTokens[1])



    const safe = await getTestSafe(user1, await safe7579.getAddress(), await safe7579.getAddress())

    return {
      testToken,
      testVaultAddress,
      testToken2,
      user1,
      user2,  
      safe,
      relayer,
      autoDCAExecutor,
      sessionValidator,
      safe7579,
      entryPoint,
      mockAccount
    }
  })


    it('should add a validator and execute DCA job', async () => {
      const {  testToken, testVaultAddress, testToken2, user1, relayer, safe, autoDCAExecutor, sessionValidator, safe7579, entryPoint, mockAccount } = await setupTests()

      await entryPoint.depositTo(await safe.getAddress(), { value: ethers.parseEther('1.0') })

      const mockLimit = await testToken.balanceOf(await mockAccount.getAddress())

      const testVault = await getTestVault(testVaultAddress); 
   
      await  testToken.connect(mockAccount).transfer(await safe.getAddress(), mockLimit)

      const abi = [
        'function executeJob(uint256 jobId) external',
      ]

     
      const execCallData = new ethers.Interface(abi).encodeFunctionData('executeJob', [0])
      const newCall = {target: await autoDCAExecutor.getAddress() as Hex, value: 0, callData: execCallData as Hex}



      await execSafeTransaction(safe, await safe7579.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0}));


      const currentTime = Math.floor(Date.now()/1000)
      const sessionKeyData = { target: await autoDCAExecutor.getAddress() as Hex, funcSelector: execCallData.slice(0, 10) as Hex, validAfter: 0, validUntil: currentTime + 100, active: true }

      const encodedSessionInitData = encodeAbiParameters(
        [{ type: 'address' },  {
          type: 'tuple',
          components: [
            { name: 'target', type: 'address' },
            { name: 'funcSelector', type: 'bytes4' },
            { name: 'validAfter', type: 'uint48' },
            { name: 'validUntil', type: 'uint48' },
            { name: 'active', type: 'bool' }
          ]
        }],
        [user1.address as Hex, sessionKeyData]
      );

      const jobData = { token: await testToken.getAddress() as Hex, targetToken: await testToken2.getAddress() as Hex,  vault: testVaultAddress as Hex, limitAmount: mockLimit, limitUsed: 0n, validAfter: 0, validUntil: currentTime + 100, lastUsed: 0, refreshInterval: 0 }

  
      const encodedDCAInitData = encodeAbiParameters(
        [{
          type: 'tuple',
          components: [
            { name: 'token', type: 'address' },
            { name: 'targetToken', type: 'address' },
            { name: 'vault', type: 'address' },

            { name: 'validAfter', type: 'uint48' },
            { name: 'validUntil', type: 'uint48' },

            { name: 'limitAmount', type: 'uint256' },
            { name: 'limitUsed', type: 'uint256' },
            { name: 'lastUsed', type: 'uint48' },
            { name: 'refreshInterval', type: 'uint48' },

          ]
        }],
        [jobData]
      );


      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(1, await sessionValidator.getAddress(), encodedSessionInitData)).data as string), value: 0})
      await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(2, await autoDCAExecutor.getAddress(), encodedDCAInitData)).data as string), value: 0})
      await execSafeTransaction(safe, await autoDCAExecutor.createJob.populateTransaction(jobData))
      await execSafeTransaction(safe, await sessionValidator.enableSessionKey.populateTransaction(user1.address, sessionKeyData))

      

      const key = BigInt(pad(await sessionValidator.getAddress() as Hex, {
          dir: "right",
          size: 24,
        }) || 0
      )
      const currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);

      let userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

      const typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
      userOp.signature = await user1.signMessage(typedDataHash)


      await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))

      expect(await testToken.balanceOf(await safe.getAddress())).to.be.eq(ethers.parseEther('0'))

      if (network.tags.polygon) {

      expect(await testVault.balanceOf(await safe.getAddress())).to.be.not.eq(ethers.parseEther('0'))

      }

    })

    // it('should execute multiple session key transaction within limit and after refresh interval', async () => {
    //   const { user1, user2, safe, spendLimitModule, safe7579, entryPoint, relayer } = await setupTests()

    //   await entryPoint.depositTo(await safe.getAddress(), { value: ethers.parseEther('1.0') })

    //   await user1.sendTransaction({ to: await safe.getAddress(), value: ethers.parseEther('1') })

    //   const abi = [
    //     'function execute(address sessionKey, uint256 sessionId, address to, uint256 value, bytes calldata data) external',
    //   ]

    //   const execCallData = new ethers.Interface(abi).encodeFunctionData('execute', [user1.address, 0, user1.address, ethers.parseEther('0.5'), '0x' as Hex])

    //   const newCall = {target: await spendLimitModule.getAddress() as Hex, value: 0, callData: execCallData as Hex}
     
    //   const currentTime = Math.floor(Date.now()/1000)
    //   const sessionData = {account: await safe.getAddress(), token: ZeroAddress,  validAfter: currentTime, validUntil: currentTime + 30, limitAmount: ethers.parseEther('0.5'), limitUsed: 0, lastUsed: 0, refreshInterval: 5 }


    //   await execSafeTransaction(safe, await safe7579.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0}));

    //   await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(1, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
    //   await execSafeTransaction(safe, {to: await safe.getAddress(), data:  ((await safe7579.installModule.populateTransaction(2, await spendLimitModule.getAddress(), '0x')).data as string), value: 0})
    //    await execSafeTransaction(safe, await spendLimitModule.addSessionKey.populateTransaction(user1.address, sessionData))
      

    //   const key = BigInt(pad(await spendLimitModule.getAddress() as Hex, {
    //       dir: "right",
    //       size: 24,
    //     }) || 0
    //   )
    //   let currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);


    //   let userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

    //   let typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
    //   userOp.signature = await user1.signMessage(typedDataHash)
      
    //   await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
    //   expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0.5'))


    //     // Wait for 5 seconds for the next subscription interval
    //     await delay(5000);

    //   currentNonce = await entryPoint.getNonce(await safe.getAddress(), key);
    //   userOp = buildUnsignedUserOpTransaction(await safe.getAddress(), currentNonce, newCall)

    //   typedDataHash = ethers.getBytes(await entryPoint.getUserOpHash(userOp))
    //   userOp.signature = await user1.signMessage(typedDataHash)
      
    //   await logGas('Execute UserOp without a prefund payment', entryPoint.handleOps([userOp], relayer))
    //   expect(await ethers.provider.getBalance(await safe.getAddress())).to.be.eq(ethers.parseEther('0'))

    // })
  
})

function delay(timeout = 10000): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeout));
}